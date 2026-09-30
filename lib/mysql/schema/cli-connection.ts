import type { SqlExecutor } from '../../interfaces/sql-executor.interface.js';
import { fromMysql2 } from '../executors/mysql2.executor.js';

/**
 * A pool of one connection on `url`, for the command line's `migrate` and `status`; `null` without the `mysql2`
 * package, which comes from the application's dependencies. The URL names the database the store's tables live in.
 */
export async function openMysql(url: string): Promise<{ executor: SqlExecutor; close(): Promise<void> } | null> {
  let createPool: typeof import('mysql2/promise').createPool;
  try {
    ({ createPool } = (await import('mysql2/promise')).default);
  } catch {
    return null;
  }

  const pool = createPool({ uri: url, connectionLimit: 1 });
  return { executor: fromMysql2(pool), close: () => pool.end() };
}
