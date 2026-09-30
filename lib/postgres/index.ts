// The `@nestjs/store-kit/postgres` entry: what a first-party PostgreSQL store is built on. Applications don't import
// it: a package's `/postgres` subpath re-exports the executors and their types. Nothing here imports a driver or an
// ORM: the executors reach the client the application passes them.

// Executors: a store's SQL through the application's pool or ORM, and its transactions
export { fromDrizzle, fromKysely, fromPg, fromPrisma, fromTypeOrm, type PrismaExecutorOptions } from './executors/index.js';
export type { SqlExecutor, SqlIsolationLevel, SqlTransaction, SqlTransactionOptions } from '../interfaces/index.js';
