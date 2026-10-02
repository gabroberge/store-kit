import type { SqlExecutor as AnySqlExecutor } from '../../interfaces/sql-executor.interface.js';

/**
 * How a PostgreSQL store reaches its database through the client the application already has: what `fromPg()`,
 * `fromSequelize()`, `fromDrizzle()`, `fromTypeOrm()`, `fromPrisma()` and `fromKysely()` from `@nestjs/store-kit/postgres` make, and what
 * a PostgreSQL store's options take. It's the root's `SqlExecutor<'postgres'>`: a value typed with it fits the store's
 * options, and a MySQL executor where it goes is a compile error (the root's `SqlExecutor` alone, for code that serves
 * both dialects, is an executor of either). `SqlExecutor<'postgres'>` names the same type.
 *
 * ```ts
 * import { fromDrizzle, PostgresOutboxStore, type SqlExecutor } from '@nestjs/outbox/postgres';
 *
 * const executor: SqlExecutor = fromDrizzle(db);
 * const store = new PostgresOutboxStore({ executor }, storage);
 * ```
 */
export type SqlExecutor<D extends 'postgres' = 'postgres'> = AnySqlExecutor<D>;
