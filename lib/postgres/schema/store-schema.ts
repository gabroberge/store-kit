import type { SqlExecutor, SqlTransaction } from '../../interfaces/sql-executor.interface.js';
import type { MigrationSqlOptions, MigrationStatementsOptions } from '../../interfaces/migration-sql-options.interface.js';
import type { StoreMigration } from '../../interfaces/store-migration.interface.js';
import type { ResolvedStoreOptions, StoreOptions } from '../../interfaces/store-options.interface.js';
import type { StoreReadiness, StoreReadinessOptions } from '../../interfaces/store-readiness.interface.js';
import type { StoreSchemaOptions } from '../../interfaces/store-schema-options.interface.js';
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
import { assertReadCommittedDefault } from '../isolation/read-committed.js';
import { advisoryLock } from '../sql/advisory-lock.js';
import { quoteSchema } from '../sql/quote-schema.js';
import { POSTGRES } from './postgres-dialect.js';

/**
 * A store's PostgreSQL schema: its versioned migrations, and all a store does with them. One per store, next to it:
 * the store's options and readiness come from it, its statics delegate to it, and the package's bin runs it
 * (`runStoreCli()` from `@nestjs/store-kit`). The schema's tables are the store's alone, in a schema of their own
 * (`nest_outbox`), which the first migration creates; a `migrations` table there records each version applied.
 *
 * ```ts
 * export const outboxSchema = new StoreSchema({
 *   packageName: '@nestjs/outbox',
 *   storeName: 'PostgresOutboxStore',
 *   command: 'nest-outbox',
 *   defaultSchema: 'nest_outbox',
 *   migrations: [initialMigration],
 *   createError: (message, details) => new OutboxSchemaError(message, details),
 * });
 *
 * export class PostgresOutboxStore implements OutboxStore, OnModuleInit {
 *   static migrationSql(options?: MigrationSqlOptions): string {
 *     return outboxSchema.sql(options);
 *   }
 *
 *   static readonly schemaVersion = outboxSchema.latest;
 *
 *   private readonly logger = new Logger('OutboxModule');
 *   private readonly executor: SqlExecutor;
 *   private readonly readiness: StoreReadiness;
 *
 *   constructor(options: PostgresOutboxStoreOptions, storage?: OutboxStorage) {
 *     const resolved = outboxSchema.resolveOptions(options);
 *     this.executor = resolved.executor;
 *     this.readiness = outboxSchema.readiness({ ...resolved, logger: this.logger });
 *     storage?.registerSource({ messages: this, inbox: this });
 *   }
 *
 *   onModuleInit(): Promise<void> {
 *     return this.readiness.ready();
 *   }
 *
 *   migrate(): Promise<number[]> {
 *     return this.readiness.migrate();
 *   }
 * }
 * ```
 */
export class StoreSchema {
  /** The database it's for: `runStoreCli()` picks a package's schema by the URL's dialect. */
  readonly dialect = 'postgres' as const;
  readonly packageName: string;
  readonly storeName: string;
  readonly command: string;
  readonly defaultSchema: string;
  /** The version the store needs: its last migration's. A store's `static schemaVersion`. */
  readonly latest: number;
  private readonly migrations: readonly StoreMigration[];
  private readonly createError: StoreSchemaOptions['createError'];

  constructor(options: StoreSchemaOptions) {
    checkSchemaOptions(options, POSTGRES);
    this.packageName = options.packageName;
    this.storeName = options.storeName;
    this.command = options.command;
    this.defaultSchema = options.defaultSchema;
    this.migrations = Object.freeze([...options.migrations]);
    this.latest = latestVersion(this.migrations);
    this.createError = options.createError;
  }

  /**
   * The statements that bring the schema from version `from` (default `0`, a new database) to `to` (default: the
   * latest), bookkeeping included: from version 0, `CREATE SCHEMA IF NOT EXISTS` and the `migrations` table first,
   * and an insert of each version after its statements. Exactly what `migrate()` runs, bar a `CREATE SCHEMA` it skips
   * when the schema exists. A `RangeError` for versions no migrations lead between (downgrades included).
   */
  statements(options: MigrationStatementsOptions = {}): string[] {
    const s = quoteSchema(options.schema ?? this.defaultSchema, this.storeName);
    const { from, to } = migrationRange(this.storeName, this.latest, options);
    const statements: string[] = [];
    if (from === 0 && to > 0) {
      statements.push(
        createSchemaStatement(s),
        `CREATE TABLE IF NOT EXISTS ${s}.migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`,
      );
    }
    for (const migration of migrationsBetween(this.migrations, from, to)) {
      statements.push(...migration.up(s), `INSERT INTO ${s}.migrations (version, name) VALUES (${migration.version}, '${migration.name}')`);
    }
    return statements;
  }

  /**
   * `statements()` as one script, for teams that migrate with their own tool (drizzle-kit, TypeORM, Prisma Migrate,
   * Flyway) and run the store with `migrate: false`: a statement per paragraph under a header, to run in one
   * transaction, or with drizzle-kit's statement breakpoints (`statementBreakpoints`). A store's
   * `static migrationSql()` returns it.
   */
  sql(options: MigrationSqlOptions = {}): string {
    const statements = this.statements(options);
    const { from, to } = migrationRange(this.storeName, this.latest, options);
    const header = [
      `-- ${this.packageName}: ${this.storeName}'s schema "${options.schema ?? this.defaultSchema}", from version ${from} to ${to}.`,
      '-- Run it in one transaction.',
    ];
    return migrationScript(header, statements, options.statementBreakpoints);
  }

  /** The last version applied to `schema`: `0` when it has none, or doesn't exist. */
  async version(db: SqlTransaction, schema: string): Promise<number> {
    const [table] = await db.query<{ exists: string }>(
      `SELECT EXISTS (
  SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1::text AND c.relname = 'migrations' AND c.relkind = 'r'
)::text AS exists`,
      [schema],
    );
    if (table?.exists !== 'true') {
      return 0;
    }

    const [row] = await db.query<{ version: string }>(`SELECT coalesce(max(version), 0)::text AS version FROM ${quoteSchema(schema, this.storeName)}.migrations`);
    return Number(row!.version);
  }

  /**
   * Throws the package's error (`createError`) unless `schema` has every migration: its message says how to migrate,
   * or `hint`. A schema ahead of the store (a newer version of the package migrated it) serves.
   */
  async assertMigrated(db: SqlTransaction, schema: string, hint?: string): Promise<void> {
    const version = await this.version(db, schema);
    if (version >= this.latest) {
      return;
    }

    throw this.createError(schemaBehindMessage(this, schema, version, this.latest, hint), { schema, version, requiredVersion: this.latest });
  }

  /**
   * Applies the migrations `schema` hasn't had yet, in one READ COMMITTED transaction that holds the advisory lock
   * `<packageName>:migrate:<schema>`: of processes that migrate together, one applies them, and the others wait for
   * its lock and find nothing to do. The lock is transaction-scoped, so it works behind a transaction-pooling
   * PgBouncer. A failure rolls it all back, with the package's error (`cause`: the database's). Resolves to the
   * versions applied.
   */
  async migrate(executor: SqlExecutor, schema: string): Promise<number[]> {
    const s = quoteSchema(schema, this.storeName);
    return executor.transaction(
      async (tx) => {
        await advisoryLock(tx, `${this.packageName}:migrate:${schema}`);
        const version = await this.version(tx, schema);
        if (version >= this.latest) {
          return [];
        }

        // A schema someone created for the store is used as it is: CREATE SCHEMA needs the CREATE privilege on the
        // database even with IF NOT EXISTS.
        const skip = (await schemaExists(tx, schema)) ? createSchemaStatement(s) : undefined;
        for (const statement of this.statements({ schema, from: version })) {
          if (statement !== skip) {
            try {
              await tx.query(statement);
            } catch (error) {
              throw this.createError(
                `${this.storeName}: migrating schema "${schema}" from version ${version} to ${this.latest} failed, and nothing was applied: ${(error as Error)?.message ?? error}`,
                { schema, version, requiredVersion: this.latest, cause: error },
              );
            }
          }
        }
        return migrationsBetween(this.migrations, version, this.latest).map((migration) => migration.version);
      },
      { isolationLevel: 'read committed' },
    );
  }

  /**
   * The store's `executor`, `schema` and `migrate` options, checked with messages that name the store (an executor of
   * another dialect included) and defaulted: `defaultSchema`, and `migrate` on except when `NODE_ENV` is `production`.
   */
  resolveOptions(options: StoreOptions): ResolvedStoreOptions {
    return resolveStoreOptions(this, POSTGRES, options);
  }

  /**
   * The store's readiness (see `StoreReadiness`): the database's default isolation checked, then the schema migrated
   * (`migrate`) or checked, once; migrations reported to `logger`.
   */
  readiness(options: StoreReadinessOptions): StoreReadiness {
    const { executor, schema } = options;
    return new Readiness(this.storeName, options, {
      check: (db) => assertReadCommittedDefault(db, this.storeName),
      assertMigrated: (db, hint) => this.assertMigrated(db, schema, hint),
      migrate: () => this.migrate(executor, schema),
    });
  }
}

function createSchemaStatement(s: string): string {
  return `CREATE SCHEMA IF NOT EXISTS ${s}`;
}

async function schemaExists(tx: SqlTransaction, schema: string): Promise<boolean> {
  const [row] = await tx.query<{ exists: string }>('SELECT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname = $1::text)::text AS exists', [schema]);
  return row?.exists === 'true';
}
