/**
 * The notes store on MySQL, built on the kit the way a package's `MySql<X>Store` is: options through
 * `resolveOptions()`, readiness before every statement (in the application's transaction too), statics that delegate
 * to the schema, statements written with `SqlParams` and read with `columns()`, `execute()`'s counts where PostgreSQL
 * has `RETURNING`, an insert-if-absent that catches a duplicate key (never `INSERT IGNORE`), and the store's own
 * transactions READ COMMITTED, retried on deadlock.
 */
import {
  columns,
  mysqlErrorCode,
  quoteTable,
  retryOnDeadlock,
  SqlParams,
  toBool,
  toInt,
  type MigrationSqlOptions,
  type MigrationStatementsOptions,
  type SqlExecutor,
  type SqlTransaction,
  type StoreOptions,
  type StoreReadiness,
} from '../../../lib/mysql/index.js';
import { mysqlNoteSchema } from './mysql-note.schema.js';
import type { NewNote, Note } from './postgres-note.store.js';

type Row = Record<string, string | null>;

const NOTE_COLUMNS = ['id', 'body', 'archived', 'created_at'];

/** ER_DUP_ENTRY. */
const DUPLICATE = 1062;

export class MySqlNoteStore {
  static migrationSql(options?: MigrationSqlOptions): string {
    return mysqlNoteSchema.sql(options);
  }

  static migrationStatements(options?: MigrationStatementsOptions): string[] {
    return mysqlNoteSchema.statements(options);
  }

  static readonly schemaVersion = mysqlNoteSchema.latest;

  /** What the store logged: its migrations. */
  readonly logged: string[] = [];
  private readonly executor: SqlExecutor;
  private readonly readiness: StoreReadiness;
  private readonly t: { notes: string; tags: string };

  constructor(options: StoreOptions) {
    const resolved = mysqlNoteSchema.resolveOptions(options);
    this.executor = resolved.executor;
    this.readiness = mysqlNoteSchema.readiness({ ...resolved, logger: { log: (message) => this.logged.push(message) } });
    const t = (table: string) => quoteTable(resolved.schema, table, mysqlNoteSchema.storeName);
    this.t = { notes: t('notes'), tags: t('note_tags') };
  }

  onModuleInit(): Promise<void> {
    return this.readiness.ready();
  }

  migrate(): Promise<number[]> {
    return this.readiness.migrate();
  }

  /** Adds a note with its tags; a known id makes it a no-op (`false`). */
  async add(note: NewNote): Promise<boolean> {
    await this.readiness.ready();
    return retryOnDeadlock(this.executor, (tx) => this.insert(tx, note));
  }

  /** `add()` in the application's transaction: the note commits or rolls back with the application's writes. */
  async addInTransaction(transaction: unknown, note: NewNote): Promise<boolean> {
    const tx = this.executor.wrapTransaction(transaction);
    await this.readiness.readyIn(tx);
    return this.insert(tx, note);
  }

  async get(id: string): Promise<Note | null> {
    await this.readiness.ready();
    const p = new SqlParams();
    const [row] = await this.executor.query<Row>(`SELECT ${columns(NOTE_COLUMNS, 'n')} FROM ${this.t.notes} n WHERE n.id = ${p.text(id)}`, p.values);
    if (!row) {
      return null;
    }

    const q = new SqlParams();
    const tags = await this.executor.query<Row>(`SELECT ${columns(['tag'], 't')} FROM ${this.t.tags} t WHERE t.note_id = ${q.text(id)} ORDER BY t.tag`, q.values);
    return { id: row.id!, body: row.body!, tags: tags.map((tag) => tag.tag!), archived: toBool(row.archived), createdAt: toInt(row.created_at)! };
  }

  /** Archives a note once: `false` for an unknown one or one archived before (no RETURNING: the rows it matched). */
  async archive(id: string): Promise<boolean> {
    await this.readiness.ready();
    const p = new SqlParams();
    const { affectedRows } = await this.executor.execute(`UPDATE ${this.t.notes} SET archived = ${p.bool(true)} WHERE id = ${p.text(id)} AND NOT archived`, p.values);
    return affectedRows === 1;
  }

  /** Deletes a note with its tags, in one transaction: no foreign key cascades them. */
  async remove(id: string): Promise<boolean> {
    await this.readiness.ready();
    return retryOnDeadlock(this.executor, async (tx) => {
      const p = new SqlParams();
      const { affectedRows } = await tx.execute(`DELETE FROM ${this.t.notes} WHERE id = ${p.text(id)}`, p.values);
      const q = new SqlParams();
      await tx.execute(`DELETE FROM ${this.t.tags} WHERE note_id = ${q.text(id)}`, q.values);
      return affectedRows === 1;
    });
  }

  private async insert(tx: SqlTransaction, note: NewNote): Promise<boolean> {
    const p = new SqlParams();
    try {
      await tx.execute(`INSERT INTO ${this.t.notes} (id, body, created_at) VALUES (${p.text(note.id)}, ${p.text(note.body)}, ${p.bigint(note.createdAt)})`, p.values);
    } catch (error) {
      // A known id: MySQL rolls the statement back, not the transaction, which goes on.
      if (mysqlErrorCode(error) === DUPLICATE) {
        return false;
      }
      throw error;
    }

    if (note.tags?.length) {
      const t = new SqlParams();
      await tx.execute(`INSERT INTO ${this.t.tags} (note_id, tag) VALUES ${note.tags.map((tag) => `(${t.text(note.id)}, ${t.text(tag)})`).join(', ')}`, t.values);
    }
    return true;
  }
}
