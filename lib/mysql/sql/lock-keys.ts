import { createHash } from 'node:crypto';
import type { SqlTransaction } from '../interfaces/mysql-executor.interface.js';
import { tableName } from './identifiers.js';

/**
 * Locks `keys` until the transaction ends: MySQL's counterpart of PostgreSQL's `advisoryLock()`
 * (`pg_advisory_xact_lock`), on rows of the kit's `<schema>_locks` table, which every store's schema has (so two
 * stores, or two schemas of one, never share a lock). `GET_LOCK()` can't serve inside a transaction: it's held by the
 * session, past the transaction's end. A key's row is its SHA-256, so any key fits and two keys never share one; the
 * rows are taken in the order of those ids, each once, so two transactions locking overlapping sets can't deadlock.
 * Exclusive locks take two statements for all the keys: the rows ensured (`INSERT ... ON DUPLICATE KEY UPDATE`, which
 * already locks an existing row exclusively), then locked (`SELECT ... FOR UPDATE`). `shared` locks (`FOR SHARE`)
 * exclude exclusive ones, not each other; a key's first lock creates its row, and holds it exclusively even when
 * asked for a shared one.
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
  const ids = [...new Set((typeof keys === 'string' ? [keys] : keys).map((key) => createHash('sha256').update(key).digest('hex')))].sort();
  if (ids.length === 0) {
    return;
  }

  const exclusive = async (locked: string[]) => {
    // InnoDB takes a multi-row insert's rows in their order, and a locking read's in its index order.
    await transaction.execute(`INSERT INTO ${table} (id) VALUES ${locked.map(() => '(?)').join(', ')} ON DUPLICATE KEY UPDATE id = id`, locked);
    await transaction.query(`SELECT id FROM ${table} WHERE id IN (${locked.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`, locked);
  };
  if (!options.shared) {
    await exclusive(ids);
    return;
  }

  // One by one, in the ids' order: a row that doesn't exist yet is created, and locked exclusively, in its turn.
  for (const id of ids) {
    const held = await transaction.query(`SELECT id FROM ${table} WHERE id = ? FOR SHARE`, [id]);
    if (held.length === 0) {
      await exclusive([id]);
    }
  }
}
