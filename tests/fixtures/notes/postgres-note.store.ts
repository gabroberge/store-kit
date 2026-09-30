/**
 * A small store built on the kit the way a package's `Postgres<X>Store` is: options through `resolveOptions()`,
 * readiness before every statement (in the application's transaction too), statics that delegate to the schema,
 * statements written with `SqlParams` and read with `columns()`.
 */
import {
  columns,
  quoteSchema,
  SqlParams,
  toBool,
  toInt,
  toText,
  type MigrationSqlOptions,
  type SqlExecutor,
  type SqlTransaction,
  type StoreOptions,
  type StoreReadiness,
} from '../../../lib/postgres/index.js';
import { noteSchema } from './note.schema.js';

export interface Note {
  id: string;
  body: string;
  tags: string[];
  archived: boolean;
  createdAt: number;
}

export type NewNote = Pick<Note, 'id' | 'body' | 'createdAt'> & { tags?: string[] };

type Row = Record<string, string | null>;

const NOTE_COLUMNS = ['id', 'body', 'archived', 'created_at'];

export class PostgresNoteStore {
  static migrationSql(options?: MigrationSqlOptions): string {
    return noteSchema.sql(options);
  }

  static readonly schemaVersion = noteSchema.latest;

  /** What the store logged: its migrations. */
  readonly logged: string[] = [];
  private readonly executor: SqlExecutor;
  private readonly readiness: StoreReadiness;
  private readonly t: { notes: string; tags: string };

  constructor(options: StoreOptions) {
    const resolved = noteSchema.resolveOptions(options);
    this.executor = resolved.executor;
    this.readiness = noteSchema.readiness({ ...resolved, logger: { log: (message) => this.logged.push(message) } });
    const s = quoteSchema(resolved.schema, noteSchema.storeName);
    this.t = { notes: `${s}.notes`, tags: `${s}.note_tags` };
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
    return this.executor.transaction((tx) => this.insert(tx, note), { isolationLevel: 'read committed' });
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
    const [row] = await this.executor.query<Row>(
      `SELECT ${columns(NOTE_COLUMNS, 'n')}, (SELECT coalesce(json_agg(t.tag ORDER BY t.tag), '[]')::text FROM ${this.t.tags} t WHERE t.note_id = n.id) AS tags
FROM ${this.t.notes} n WHERE n.id = ${p.text(id)}`,
      p.values,
    );
    return row
      ? { id: row.id!, body: row.body!, tags: JSON.parse(row.tags!) as string[], archived: toBool(row.archived), createdAt: toInt(row.created_at)! }
      : null;
  }

  async archive(id: string): Promise<boolean> {
    await this.readiness.ready();
    const p = new SqlParams();
    const archived = await this.executor.query<Row>(`UPDATE ${this.t.notes} SET archived = true WHERE id = ${p.text(id)} AND NOT archived RETURNING id`, p.values);
    return archived.length === 1;
  }

  private async insert(tx: SqlTransaction, note: NewNote): Promise<boolean> {
    const p = new SqlParams();
    const [inserted] = await tx.query<Row>(
      `INSERT INTO ${this.t.notes} (id, body, created_at) VALUES (${p.text(note.id)}, ${p.text(note.body)}, ${p.bigint(note.createdAt)})
ON CONFLICT (id) DO NOTHING RETURNING id`,
      p.values,
    );
    if (!inserted || !note.tags?.length) {
      return toText(inserted?.id) !== null;
    }

    const t = new SqlParams();
    const id = t.text(note.id);
    await tx.query(`INSERT INTO ${this.t.tags} (note_id, tag) VALUES ${note.tags.map((tag) => `(${id}, ${t.text(tag)})`).join(', ')}`, t.values);
    return true;
  }
}
