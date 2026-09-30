import { createHash } from 'node:crypto';
import type { SqlTransaction } from '../interfaces/mysql-executor.interface.js';
import { tableName } from './identifiers.js';

/**
 * Locks `keys` until the transaction ends: MySQL's counterpart of PostgreSQL's `advisoryLock()`
 * (`pg_advisory_xact_lock`), on rows of the kit's `<schema>_locks` table, which every store's schema has. `GET_LOCK()`
 * can't serve inside a transaction: it's held by the session, past the transaction's end. Each key's row is ensured
 * (`INSERT ... ON DUPLICATE KEY UPDATE`, which already locks an existing row exclusively), then locked
 * (`SELECT ... FOR UPDATE`, or `FOR SHARE` for `shared`); the row is keyed by the key's SHA-256, so any key fits.
 * Several keys are taken one after another in sorted order, each once, so two transactions locking overlapping sets
 * can't deadlock. `shared` locks exclude exclusive ones, not each other; the first lock of a key creates its row and
 * holds it exclusively even when asked for a shared one. Key them `<what>:<id>` (the table is the store's schema's).
 *
 * ```ts
 * await retryOnDeadlock(this.executor, async (tx) => {
 *   await lockKeys(tx, this.schema, messages.map((message) => `key:${message.key}`));
 *   // insert the messages: a key's writers take turns until each commits
 * });
 * ```
 *
 * In a REPEATABLE READ transaction (the application's, MySQL's default), locking a key that has no row yet takes a gap
 * lock, and two transactions doing that for the same new key at once deadlock: one of them fails with 1213.
 */
export async function lockKeys(transaction: SqlTransaction, schema: string, keys: string | readonly string[], options: { shared?: boolean } = {}): Promise<void> {
  const table = tableName(schema, 'locks', 'lockKeys()');
  for (const key of typeof keys === 'string' ? [keys] : [...new Set(keys)].sort()) {
    const id = createHash('sha256').update(key).digest('hex');
    if (options.shared) {
      const held = await transaction.query(`SELECT id FROM ${table} WHERE id = ? FOR SHARE`, [id]);
      if (held.length > 0) {
        continue;
      }
    }

    await transaction.execute(`INSERT INTO ${table} (id) VALUES (?) ON DUPLICATE KEY UPDATE id = id`, [id]);
    await transaction.query(`SELECT id FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
  }
}
