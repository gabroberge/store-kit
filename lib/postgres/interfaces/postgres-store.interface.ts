import type { ResolvedStoreOptions as AnyResolvedStoreOptions, StoreOptions as AnyStoreOptions } from '../../interfaces/store-options.interface.js';
import type { StoreReadinessOptions as AnyStoreReadinessOptions } from '../../interfaces/store-readiness.interface.js';

/**
 * The options every first-party PostgreSQL store takes (`new PostgresOutboxStore({ executor, schema, migrate }, storage)`),
 * which `StoreSchema.resolveOptions()` checks: the root's `StoreOptions<'postgres'>`, whose `executor` is a PostgreSQL
 * executor (a MySQL one is a compile error). A store's own options interface may add more.
 *
 * ```ts
 * export interface PostgresOutboxStoreOptions extends StoreOptions {
 *   // the store's own options, if any
 * }
 * ```
 */
export type StoreOptions<D extends 'postgres' = 'postgres'> = AnyStoreOptions<D>;

/**
 * `StoreSchema.resolveOptions()`'s result on PostgreSQL: the options checked, with their defaults, the executor a
 * PostgreSQL one (`SqlExecutor`).
 *
 * ```ts
 * const { executor, schema, migrate } = outboxSchema.resolveOptions(options);
 * ```
 */
export type ResolvedStoreOptions<D extends 'postgres' = 'postgres'> = AnyResolvedStoreOptions<D>;

/**
 * What `StoreSchema.readiness()` takes on PostgreSQL: the store's resolved options, and where a migration is reported.
 *
 * ```ts
 * this.readiness = outboxSchema.readiness({ ...outboxSchema.resolveOptions(options), logger: this.logger });
 * ```
 */
export type StoreReadinessOptions<D extends 'postgres' = 'postgres'> = AnyStoreReadinessOptions<D>;
