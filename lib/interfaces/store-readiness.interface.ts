import type { SqlDialect, SqlTransaction } from './sql-executor.interface.js';
import type { ResolvedStoreOptions } from './store-options.interface.js';

/**
 * What `StoreSchema.readiness()` takes: the store's resolved options, and where a migration is reported. `D` is the
 * store's dialect, as in `ResolvedStoreOptions`.
 *
 * ```ts
 * this.readiness = outboxSchema.readiness({ ...outboxSchema.resolveOptions(options), logger: this.logger });
 * ```
 */
export interface StoreReadinessOptions<D extends SqlDialect = SqlDialect> extends ResolvedStoreOptions<D> {
  /**
   * Told when the store applies migrations (`PostgresOutboxStore: migrated schema "nest_outbox" to version 2.`): the
   * store's Nest `Logger`, typically.
   */
  logger?: { log(message: string): void };
}

/**
 * What a store awaits before its statements, made by `StoreSchema.readiness()`: the database's default isolation
 * checked (READ COMMITTED: a store's statements race each other), then the schema migrated (`migrate`) or checked
 * against the store's migrations. Once it succeeds, it costs nothing; a failure is tried again at the next call, so a
 * migration applied meanwhile is picked up without a restart.
 *
 * ```ts
 * async onModuleInit(): Promise<void> {
 *   await this.readiness.ready(); // before the workers start: startup fails if the schema can't serve
 * }
 *
 * async add(transaction: unknown, messages: NewMessage[]): Promise<void> {
 *   const tx = this.executor.wrapTransaction(transaction);
 *   await this.readiness.readyIn(tx);
 *   await tx.query(insertStatement, params.values);
 * }
 * ```
 */
export interface StoreReadiness {
  /**
   * Resolves once the schema can serve: migrated (with `migrate`) or checked. Call it first in `onModuleInit()` and in
   * every method that runs on the store's own connections: outside Nest (scripts, the contract suites), the first
   * call prepares the store.
   */
  ready(): Promise<void>;
  /**
   * The same checks through the application's transaction, for a store method that runs in one and may be the store's
   * first call (outside Nest, or from another module's `onModuleInit`): a statement outside the transaction could wait
   * for it forever on a one-connection database (PGlite, a pool of one). It never migrates: that would put the
   * store's DDL in the application's transaction, so a schema that's behind fails.
   */
  readyIn(transaction: SqlTransaction): Promise<void>;
  /**
   * Applies the pending migrations now, whatever `migrate` says, as `StoreSchema.migrate()` does, and reports them to
   * `logger`. Resolves to the versions it applied (`[]`: none were pending). A store's public `migrate()` returns it.
   */
  migrate(): Promise<number[]>;
}
