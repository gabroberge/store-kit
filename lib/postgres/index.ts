// The `@nestjs/store-kit/postgres` entry: what a first-party PostgreSQL store is built on. Applications don't import
// it: a package's `/postgres` subpath re-exports the executors and their types. Nothing here imports a driver or an
// ORM: the executors reach the client the application passes them.

// Executors: a store's SQL through the application's pool or ORM, and its transactions (`SqlExecutor` here is
// PostgreSQL's: the root's `SqlExecutor<'postgres'>`), and their refusal of an object that isn't a transaction they
// can join, by its code
export { fromDrizzle, fromKysely, fromPg, fromPrisma, fromSequelize, fromTypeOrm, type PrismaExecutorOptions } from './executors/index.js';
export type { SqlExecutor } from './interfaces/index.js';
export type { SqlIsolationLevel, SqlTransaction, SqlTransactionOptions } from '../interfaces/index.js';
export { isNotATransactionError } from '../sql/index.js';

// A store's schema: its versioned migrations and their SQL, the store's options (PostgreSQL's), and its readiness
export { StoreSchema } from './schema/index.js';
export type { ResolvedStoreOptions, StoreOptions, StoreReadinessOptions } from './interfaces/index.js';
export type {
  MigrationSqlOptions,
  MigrationStatementsOptions,
  StoreMigration,
  StoreReadiness,
  StoreSchemaErrorDetails,
  StoreSchemaOptions,
} from '../interfaces/index.js';

// A store's statements: parameters as text with casts, columns read as text, the schema quoted, advisory locks
export { advisoryLock, columns, quoteSchema, SqlParams, toBool, toInt, toJson, toText, type AdvisoryLockOptions } from './sql/index.js';

// Isolation: the application's transaction a store method joins must be READ COMMITTED
export { assertReadCommittedTransaction } from './isolation/index.js';
