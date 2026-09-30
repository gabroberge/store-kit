import type { SqlExecutor } from './sql-executor.interface.js';

/**
 * The options every first-party SQL store takes (`new PostgresOutboxStore({ executor, schema, migrate }, storage)`),
 * which `StoreSchema.resolveOptions()` checks. A store's own options interface may add more.
 *
 * ```ts
 * export interface PostgresOutboxStoreOptions extends StoreOptions {
 *   // the store's own options, if any
 * }
 * ```
 */
export interface StoreOptions {
  /**
   * How the store reaches the database: an executor of the store's dialect, such as `fromPg(pool)`,
   * `fromDrizzle(db)`, `fromTypeOrm(dataSource)`, `fromPrisma(prisma)` or `fromKysely(db)` from the store's
   * `/postgres` subpath. The store's own transactions run on it, and methods that take the application's transaction
   * take that client's transaction object.
   */
  executor: SqlExecutor;
  /**
   * The schema that holds the store's tables, created by its first migration: keep it for the store alone. Letters,
   * digits and underscores, not starting with a digit, at most 63 characters. Default: the store's (`nest_<package>`).
   */
  schema?: string;
  /**
   * Apply the store's pending migrations at startup, so processes that start together migrate once. With `false`,
   * startup fails while the schema is behind the store: apply them with the package's command (`npx nest-<package>
   * migrate`), or with your own migration tool (`migrationSql()`). Default: `true`, except when `NODE_ENV` is
   * `production`.
   */
  migrate?: boolean;
}

/**
 * `StoreSchema.resolveOptions()`'s result: the options checked, with their defaults.
 *
 * ```ts
 * const { executor, schema, migrate } = outboxSchema.resolveOptions(options);
 * ```
 */
export interface ResolvedStoreOptions {
  executor: SqlExecutor;
  /** The schema's name, checked (quote it with the dialect's `quoteSchema()`). */
  schema: string;
  migrate: boolean;
}
