// The `@nestjs/store-kit` entry: what every dialect shares. A store is built from its dialect's entry
// (`@nestjs/store-kit/postgres`, `@nestjs/store-kit/mysql`), and applications import neither: a package's `/postgres`
// and `/mysql` subpaths re-export the executors and their types.

// Executors, as every dialect's stores take them
export type { SqlExecuteResult, SqlExecutor, SqlIsolationLevel, SqlTransaction, SqlTransactionOptions } from './interfaces/index.js';

// The readers of the text every column is read as (`columns()`), the same on every dialect: a package's row mapping
// serves its PostgreSQL and MySQL stores alike
export { toBool, toInt, toJson, toText } from './sql/index.js';

// A package's command for its stores' schemas (`nest-<package> migrate|status|sql`), by the URL's dialect
export { runStoreCli } from './cli/index.js';
export type { StoreCliIo } from './interfaces/index.js';
