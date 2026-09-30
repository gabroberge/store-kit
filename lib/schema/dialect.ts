import type { SqlDialect } from '../interfaces/sql-executor.interface.js';

/** A database a store can run on: an executor's `dialect`. */
export type { SqlDialect };

/** How messages name each dialect. */
export const DIALECT_NAMES: Record<SqlDialect, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
};

/**
 * What the pieces every dialect shares need to know of one: its executors, as messages suggest them, and its rule for
 * a schema's name. Each dialect's `StoreSchema` passes its own.
 */
export interface DialectInfo {
  readonly dialect: SqlDialect;
  /** As a message suggests them: `fromPg(pool), fromDrizzle(db), fromTypeOrm(dataSource), fromPrisma(prisma) or fromKysely(db)`. */
  readonly executors: string;
  /** As an import names them: `fromPg, fromDrizzle, fromTypeOrm, fromPrisma or fromKysely`. */
  readonly executorNames: string;
  /** Throws a `TypeError` that names `store` unless `schema` is a schema name of the dialect. */
  checkSchema(schema: unknown, store: string): void;
}
