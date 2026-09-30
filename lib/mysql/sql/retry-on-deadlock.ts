import type { SqlIsolationLevel } from '../../interfaces/sql-executor.interface.js';
import type { SqlExecutor, SqlTransaction } from '../interfaces/mysql-executor.interface.js';
import { mysqlErrorCode } from './errors.js';

/** ER_LOCK_DEADLOCK: MySQL rolled the whole transaction back to break a deadlock. */
const DEADLOCK = 1213;

/**
 * Runs `work` in a transaction of the store's own, READ COMMITTED unless `isolationLevel` says otherwise, and runs it
 * again in a new transaction when MySQL rolled it back to break a deadlock (1213): at most `attempts` runs in all
 * (default 3), after a short random pause each. Any other error, and the last deadlock, reject as they are. `work`
 * must be safe to run again: it only touches the database, whose changes the deadlock rolled back.
 *
 * ```ts
 * complete(id: string, token: string): Promise<boolean> {
 *   return retryOnDeadlock(this.executor, async (tx) => {
 *     await lockKeys(tx, this.schema, `job:${id}`);
 *     const p = new SqlParams();
 *     return (await tx.execute(`DELETE FROM ${this.t.jobs} WHERE id = ${p.text(id)} AND lease_token = ${p.text(token)}`, p.values)).affectedRows === 1;
 *   });
 * }
 * ```
 *
 * It takes the executor, never the application's transaction: a deadlock there rolled the application's own writes
 * back too, so only the application can run it again. A store method that works in the application's transaction lets
 * the error through.
 */
export async function retryOnDeadlock<T>(
  executor: SqlExecutor,
  work: (transaction: SqlTransaction) => Promise<T>,
  options: { isolationLevel?: SqlIsolationLevel; attempts?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new TypeError(`retryOnDeadlock() takes a whole number of attempts from 1, not ${JSON.stringify(attempts)}.`);
  }

  const isolationLevel = options.isolationLevel ?? 'read committed';
  for (let attempt = 1; ; attempt++) {
    try {
      return await executor.transaction(work, { isolationLevel });
    } catch (error) {
      if (attempt >= attempts || mysqlErrorCode(error) !== DEADLOCK) {
        throw error;
      }
      // Transactions that deadlocked together would meet again if they started again together.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * attempt));
    }
  }
}
