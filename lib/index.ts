// The `@nestjs/store-kit` entry: what every dialect shares. A store is built from its dialect's entry
// (`@nestjs/store-kit/postgres`), and applications import neither: a package's `/postgres` subpath re-exports the
// executors and their types.

// Executors, as every dialect's stores take them
export type { SqlExecutor, SqlIsolationLevel, SqlTransaction, SqlTransactionOptions } from './interfaces/index.js';

// A package's command for its stores' schemas (`nest-<package> migrate|status|sql`), by the URL's dialect
export { runStoreCli } from './cli/index.js';
export type { StoreCliIo } from './interfaces/index.js';
