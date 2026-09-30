// The `@nestjs/store-kit/mysql` entry: what a first-party MySQL store is built on. Applications don't import it: a
// package's `/mysql` subpath re-exports the executors and their types. Nothing here imports a driver or an ORM: the
// executors reach the client the application passes them.

// Executors: a store's SQL through the application's pool or ORM, and its transactions
export { fromDrizzle, fromKysely, fromMysql2, fromPrisma, fromTypeOrm } from './executors/index.js';
export type { PrismaExecutorOptions } from '../postgres/executors/prisma.executor.js';
export type { SqlExecutor, SqlTransaction } from './interfaces/index.js';
export type { SqlExecuteResult, SqlIsolationLevel, SqlTransactionOptions } from '../interfaces/index.js';

// A store's statements: parameters as text with casts, columns read as text, identifiers and tables quoted, key
// columns, MySQL's error numbers
export { columns, keyColumn, mysqlErrorCode, quoteIdentifier, quoteTable, SqlParams, toBool, toInt, toJson, toText } from './sql/index.js';
