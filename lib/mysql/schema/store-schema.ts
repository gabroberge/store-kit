import { createHash } from 'node:crypto';
import type { SqlExecutor as AnySqlExecutor, SqlTransaction as AnySqlTransaction } from '../../interfaces/sql-executor.interface.js';
import type { MigrationSqlOptions, MigrationStatementsOptions } from '../../interfaces/migration-sql-options.interface.js';
import type { StoreOptions as AnyStoreOptions } from '../../interfaces/store-options.interface.js';
import type { StoreReadiness } from '../../interfaces/store-readiness.interface.js';
import {
  checkSchemaOptions,
  latestVersion,
  migrationRange,
  migrationScript,
  migrationsBetween,
  Readiness,
  resolveStoreOptions,
  schemaBehindMessage,
} from '../../schema/index.js';
import { databaseMessage } from '../../utils/error.util.js';
import { hasMethod } from '../../utils/executor.util.js';
import type { ResolvedStoreOptions, StoreMigration, StoreOptions, StoreReadinessOptions, StoreSchemaOptions } from '../interfaces/mysql-store.interface.js';
import { mysqlErrorCode } from '../sql/errors.js';
import { checkSchema, quoteTable, tableName } from '../sql/identifiers.js';
import { SqlParams } from '../sql/sql-params.js';
import { MYSQL } from './mysql-dialect.js';
import { checkServer } from './server-check.js';

/** The first word of the statements a MySQL migration may hold: DDL, which MySQL commits on its own. */
const DDL = /^(CREATE|ALTER|DROP)\b/i;

/**
 * What MySQL says when a DDL statement that already ran runs again: the table, column, index or constraint exists, or
 * the one it drops is gone. After a crash between a statement and its record, the statement runs again, and one of
 * these means it had been applied.
 */
const ALREADY_APPLIED = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1051, // ER_BAD_TABLE_ERROR (DROP TABLE)
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1068, // ER_MULTIPLE_PRI_KEY
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
  3822, // ER_CHECK_CONSTRAINT_DUP_NAME
]);

/**
 * A store's MySQL schema: its versioned migrations, and all a store does with them. One per store, next to it: the
 * store's options and readiness come from it, its statics delegate to it, and the package's bin runs it
 * (`runStoreCli()` from `@nestjs/store-kit`). The store's tables live in the connection's database, each named
 * `<schema>_<table>` (`nest_outbox_messages`), next to the kit's `<schema>_migrations` (a row per version) and
 * `<schema>_locks` (`lockKeys()`).
 *
 * MySQL commits each DDL statement on its own, so a migration can't be one transaction: `migrate()` applies the
 * statements one at a time on one connection, under `GET_LOCK()`, and records each, so a run that failed or crashed
 * halfway resumes where it stopped and never applies a statement twice.
 *
 * ```ts
 * export const outboxSchema = new StoreSchema({
 *   packageName: '@nestjs/outbox',
 *   storeName: 'MySqlOutboxStore',
 *   command: 'nest-outbox',
 *   defaultSchema: 'nest_outbox',
 *   migrations: [initialMigration], // { version: 1, name: 'initial', up: (t) => [`CREATE TABLE ${t('messages')} (...)`] }
 *   createError: (message, details) => new OutboxSchemaError(message, details),
 * });
 *
 * export class MySqlOutboxStore implements OutboxStore, OnModuleInit {
 *   static migrationSql(options?: MigrationSqlOptions): string {
 *     return outboxSchema.sql(options);
 *   }
 *
 *   static migrationStatements(options?: MigrationStatementsOptions): string[] {
 *     return outboxSchema.statements(options);
 *   }
 *
 *   static readonly schemaVersion = outboxSchema.latest;
 *
 *   private readonly executor: SqlExecutor;
 *   private readonly readiness: StoreReadiness;
 *
 *   constructor(options: MySqlOutboxStoreOptions, storage?: OutboxStorage) {
 *     const resolved = outboxSchema.resolveOptions(options);
 *     this.executor = resolved.executor;
 *     this.readiness = outboxSchema.readiness({ ...resolved, logger: new Logger('OutboxModule') });
 *     storage?.registerSource({ messages: this, inbox: this });
 *   }
 *
 *   onModuleInit(): Promise<void> {
 *     return this.readiness.ready();
 *   }
 * }
 * ```
 */
export class StoreSchema {
  /** The database it's for: `runStoreCli()` picks a package's schema by the URL's dialect. */
  readonly dialect = 'mysql' as const;
  readonly packageName: string;
  readonly storeName: string;
  readonly command: string;
  readonly defaultSchema: string;
  /** The version the store needs: its last migration's. A store's `static schemaVersion`. */
  readonly latest: number;
  private readonly migrations: readonly StoreMigration[];
  private readonly createError: StoreSchemaOptions['createError'];

  constructor(options: StoreSchemaOptions) {
    checkSchemaOptions(options, MYSQL);
    this.packageName = options.packageName;
    this.storeName = options.storeName;
    this.command = options.command;
    this.defaultSchema = options.defaultSchema;
    this.migrations = Object.freeze([...options.migrations]);
    this.latest = latestVersion(this.migrations);
    this.createError = options.createError;
    // Each migration's statements, for the default schema: a statement that isn't DDL, or a table name MySQL would
    // refuse, fails when the store's module loads.
    for (const migration of this.migrations) {
      this.migrationStatements(migration, this.defaultSchema);
    }
  }

  /**
   * The statements that bring the schema from version `from` (default `0`, a new database) to `to` (default: the
   * latest), bookkeeping included: from version 0, the kit's `<schema>_migrations` and `<schema>_locks` tables first
   * (`CREATE TABLE IF NOT EXISTS`), and an insert of each version after its statements. Run them one at a time, in
   * order, each once (TypeORM's `queryRunner.query()` and mysql2 run one statement per call): they don't run in one
   * transaction, as MySQL commits each DDL statement on its own. `migrate()` runs the same DDL, and records its progress
   * after each statement instead of the version at the end. A `RangeError` for versions no migrations lead between.
   */
  statements(options: MigrationStatementsOptions = {}): string[] {
    const schema = options.schema ?? this.defaultSchema;
    checkSchema(schema, this.storeName);
    const { from, to } = migrationRange(this.storeName, this.latest, options);
    const statements: string[] = [];
    if (from === 0 && to > 0) {
      statements.push(...this.bookkeeping(schema));
    }
    for (const migration of migrationsBetween(this.migrations, from, to)) {
      statements.push(
        ...this.migrationStatements(migration, schema),
        `INSERT INTO ${this.table(schema, 'migrations')} (version, name, applied_at) VALUES (${migration.version}, '${migration.name}', UNIX_TIMESTAMP() * 1000)`,
      );
    }
    return statements;
  }

  /**
   * `statements()` as one script, for teams that migrate with their own tool (drizzle-kit, TypeORM, Prisma Migrate,
   * Flyway) and run the store with `migrate: false`: a statement per paragraph under a header, or with drizzle-kit's
   * statement breakpoints (`statementBreakpoints`), which its MySQL migrator splits the file on, as mysql2 runs one
   * statement per call. A store's `static migrationSql()` returns it.
   */
  sql(options: MigrationSqlOptions = {}): string {
    const statements = this.statements(options);
    const { from, to } = migrationRange(this.storeName, this.latest, options);
    const schema = options.schema ?? this.defaultSchema;
    const header = [
      `-- ${this.packageName}: ${this.storeName}'s schema "${schema}" (tables ${schema}_*), from version ${from} to ${to}.`,
      "-- The statements don't run in one transaction: MySQL commits each DDL statement on its own. Apply them in order, each once.",
    ];
    return migrationScript(header, statements, options.statementBreakpoints);
  }

  /** The last version applied to `schema`: `0` when it has none. Checks the server first (see `readiness()`). */
  async version(db: AnySqlTransaction, schema: string): Promise<number> {
    await checkServer(db, this.storeName);
    return this.readVersion(db, schema);
  }

  /**
   * Throws the package's error (`createError`) unless `schema` has every migration: its message says how to migrate,
   * or `hint`. A schema ahead of the store (a newer version of the package migrated it) serves.
   */
  async assertMigrated(db: AnySqlTransaction, schema: string, hint?: string): Promise<void> {
    await checkServer(db, this.storeName);
    await this.assertVersion(db, schema, hint);
  }

  /**
   * Applies the migrations `schema` hasn't had yet, one statement at a time, on one connection (the executor's
   * transaction, ended at once: MySQL commits DDL on its own), under `GET_LOCK()` of `<packageName>:migrate:<schema>`
   * in the connection's database, released in a `finally` (the server releases it too if the connection dies): of
   * processes that migrate together, one applies them, and the others wait for its lock and find nothing to do. Each
   * statement is recorded as started and as applied, so a run that failed or crashed halfway resumes at the statement it
   * stopped at: one that failed changed nothing (MySQL's DDL is atomic) and runs again; one a crash cut off from its
   * record runs again, and MySQL's saying it's already applied (the table, column or index exists) counts as applied. A
   * failure rejects with the package's error (`cause`: the database's). Resolves to the versions applied.
   */
  async migrate(executor: AnySqlExecutor, schema: string): Promise<number[]> {
    checkSchema(schema, this.storeName);
    return executor.transaction(
      async (tx) => {
        const { database } = await checkServer(tx, this.storeName);
        const current = await this.readVersion(tx, schema);
        if (current >= this.latest) {
          return [];
        }

        // GET_LOCK() names are the server's, not a database's, and at most 64 characters: the name hashes the database
        // with the key. It waits as long as another process migrates (-1), as PostgreSQL's advisory lock does.
        const lock = `store-kit:migrate:${createHash('sha256').update(`${database}\u0000${this.packageName}:migrate:${schema}`).digest('hex').slice(0, 46)}`;
        const [taken] = await tx.query<{ taken: string | null }>('SELECT CAST(GET_LOCK(?, -1) AS CHAR) AS taken', [lock]);
        if (taken?.taken !== '1') {
          throw this.createError(
            `${this.storeName}: migrating schema "${schema}" from version ${current} to ${this.latest} failed: MySQL didn't grant its migration lock (GET_LOCK() returned ${taken?.taken ?? 'NULL'}).`,
            { schema, version: current, requiredVersion: this.latest },
          );
        }
        try {
          // The executor's transaction ends here: each statement below commits on its own, as MySQL's DDL does anyway.
          await tx.query('COMMIT');
          return await this.applyPending(tx, schema);
        } finally {
          await tx.query('DO RELEASE_LOCK(?)', [lock]).catch(() => undefined);
        }
      },
      { isolationLevel: 'read committed' },
    );
  }

  /**
   * The store's `executor`, `schema` and `migrate` options, checked with messages that name the store (an executor of
   * another dialect included) and defaulted: `defaultSchema`, and `migrate` on except when `NODE_ENV` is `production`.
   */
  resolveOptions(options: StoreOptions): ResolvedStoreOptions {
    const resolved = resolveStoreOptions(this, MYSQL, options as AnyStoreOptions);
    if (!hasMethod(resolved.executor, 'execute')) {
      throw new TypeError(`${this.storeName}: \`executor\` must be a SqlExecutor, such as ${MYSQL.executors}.`);
    }
    return resolved as ResolvedStoreOptions;
  }

  /**
   * The store's readiness (see `StoreReadiness`): the server and connection checked (MySQL, not MariaDB; 8.0.19 or
   * later; a strict `sql_mode`; a current database), then the schema migrated (`migrate`) or checked, once;
   * migrations reported to `logger`.
   */
  readiness(options: StoreReadinessOptions): StoreReadiness {
    const { executor, schema } = options;
    return new Readiness(this.storeName, options, {
      check: async (db) => {
        await checkServer(db, this.storeName);
      },
      assertMigrated: (db, hint) => this.assertVersion(db, schema, hint),
      migrate: () => this.migrate(executor, schema),
    });
  }

  private async assertVersion(db: AnySqlTransaction, schema: string, hint?: string): Promise<void> {
    const version = await this.readVersion(db, schema);
    if (version >= this.latest) {
      return;
    }

    throw this.createError(schemaBehindMessage(this, schema, version, this.latest, hint), { schema, version, requiredVersion: this.latest });
  }

  private async readVersion(db: AnySqlTransaction, schema: string): Promise<number> {
    const [table] = await db.query<{ found: string }>(
      'SELECT CAST(COUNT(*) AS CHAR) AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [`${schema}_migrations`],
    );
    if (table?.found !== '1') {
      return 0;
    }

    const [row] = await db.query<{ version: string }>(`SELECT CAST(COALESCE(MAX(version), 0) AS CHAR) AS version FROM ${this.table(schema, 'migrations')} WHERE applied_at IS NOT NULL`);
    return Number(row!.version);
  }

  /** The pending migrations, statement by statement, with each one's progress in the version's row. */
  private async applyPending(tx: AnySqlTransaction, schema: string): Promise<number[]> {
    const version = await this.readVersion(tx, schema);
    if (version >= this.latest) {
      return [];
    }

    const migrations = this.table(schema, 'migrations');
    const fail = (where: string, reached: number, cause: unknown, after = '') =>
      this.createError(
        `${this.storeName}: migrating schema "${schema}" from version ${version} to ${this.latest} ${where}: ${databaseMessage(cause)}${after}`,
        { schema, version: reached, requiredVersion: this.latest, cause },
      );

    for (const statement of this.bookkeeping(schema)) {
      await tx.query(statement).catch((error: unknown) => {
        throw fail("failed creating the kit's tables", version, error);
      });
    }

    const applied: number[] = [];
    for (const migration of migrationsBetween(this.migrations, version, this.latest)) {
      const statements = this.migrationStatements(migration, schema);
      const p = new SqlParams();
      await tx.query(`INSERT INTO ${migrations} (version, name) VALUES (${p.int(migration.version)}, ${p.text(migration.name)}) ON DUPLICATE KEY UPDATE version = version`, p.values);
      const q = new SqlParams();
      const [progress] = await tx.query<{ started: string; applied: string }>(
        `SELECT CAST(started AS CHAR) AS started, CAST(applied AS CHAR) AS applied FROM ${migrations} WHERE version = ${q.int(migration.version)}`,
        q.values,
      );

      let uncertain = Number(progress!.started) > Number(progress!.applied);
      for (let index = Number(progress!.applied); index < statements.length; index++) {
        const position = `at migration ${migration.version} (${migration.name}), statement ${index + 1} of ${statements.length}`;
        if (!uncertain) {
          await this.record(tx, migrations, migration.version, { started: index + 1 });
        }
        try {
          await tx.query(statements[index]!);
        } catch (error) {
          const code = mysqlErrorCode(error);
          if (!uncertain || code === undefined || !ALREADY_APPLIED.has(code)) {
            // A statement MySQL refused changed nothing: a new run applies it again. Without an error number (a lost
            // connection) it may have been applied, and stays uncertain.
            if (code !== undefined) {
              await this.record(tx, migrations, migration.version, { started: index }).catch(() => undefined);
            }
            throw fail(`stopped ${position}`, migration.version - 1, error, '. The statements before it are applied, and migrating again resumes at it.');
          }
        }

        uncertain = false;
        await this.record(tx, migrations, migration.version, { started: index + 1, applied: index + 1 });
      }

      const done = new SqlParams();
      await tx.query(`UPDATE ${migrations} SET applied_at = UNIX_TIMESTAMP() * 1000 WHERE version = ${done.int(migration.version)}`, done.values);
      applied.push(migration.version);
    }
    return applied;
  }

  private record(tx: AnySqlTransaction, migrations: string, version: number, progress: { started: number; applied?: number }): Promise<unknown> {
    const p = new SqlParams();
    const set = [`started = ${p.int(progress.started)}`, ...(progress.applied === undefined ? [] : [`applied = ${p.int(progress.applied)}`])];
    return tx.query(`UPDATE ${migrations} SET ${set.join(', ')} WHERE version = ${p.int(version)}`, p.values);
  }

  /** The kit's tables in every store's schema: a row per version (and the progress of one being applied), and lock rows. */
  private bookkeeping(schema: string): string[] {
    return [
      `CREATE TABLE IF NOT EXISTS ${this.table(schema, 'migrations')} (
  version int NOT NULL PRIMARY KEY,
  name varchar(255) NOT NULL,
  applied_at bigint,
  started int NOT NULL DEFAULT 0,
  applied int NOT NULL DEFAULT 0
)`,
      `CREATE TABLE IF NOT EXISTS ${this.table(schema, 'locks')} (
  id char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY
)`,
    ];
  }

  /** A migration's statements for `schema`, each checked: a string, DDL. */
  private migrationStatements(migration: StoreMigration, schema: string): string[] {
    const statements = migration.up((table) => quoteTable(schema, table, this.storeName));
    if (!Array.isArray(statements)) {
      throw new TypeError(`${this.storeName}'s StoreSchema: migration ${migration.version} (${migration.name}) must return its statements, an array of strings.`);
    }
    for (const statement of statements) {
      if (typeof statement !== 'string' || !DDL.test(statement.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, ''))) {
        throw new TypeError(
          `${this.storeName}'s StoreSchema: migration ${migration.version} (${migration.name}) has a statement that isn't DDL: ${JSON.stringify(statement).slice(0, 80)}. ` +
            'A MySQL migration holds CREATE, ALTER and DROP statements, which MySQL commits one by one.',
        );
      }
    }
    return statements;
  }

  private table(schema: string, table: 'migrations' | 'locks'): string {
    return tableName(schema, table, this.storeName);
  }
}
