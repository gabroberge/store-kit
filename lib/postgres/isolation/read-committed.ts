import type { SqlTransaction } from '../../interfaces/sql-executor.interface.js';

/**
 * Fails unless the application's transaction runs at READ COMMITTED, PostgreSQL's default: call it before a store
 * method that relies on it does anything in that transaction, so a refused call holds nothing. Under REPEATABLE READ
 * or SERIALIZABLE the transaction reads one snapshot, so a statement that waited for a lock doesn't see what the lock's
 * holder committed. `operation` names the call and `reason` what would go wrong: the `TypeError` reads "<operation>
 * needs a READ COMMITTED transaction (PostgreSQL's default); this one is <level>: <reason>."
 *
 * ```ts
 * const tx = this.executor.wrapTransaction(transaction);
 * await assertReadCommittedTransaction(tx, {
 *   operation: 'signal() with { transaction }',
 *   reason: 'its wake-ups would miss the waits committed after its snapshot',
 * });
 * ```
 */
export async function assertReadCommittedTransaction(transaction: SqlTransaction, words: { operation: string; reason: string }): Promise<void> {
  const [row] = await transaction.query<{ isolation: string }>("SELECT current_setting('transaction_isolation') AS isolation");
  if (row?.isolation !== 'read committed') {
    throw new TypeError(`${words.operation} needs a READ COMMITTED transaction (PostgreSQL's default); this one is ${row?.isolation}: ${words.reason}.`);
  }
}

/**
 * A store's statements outside its transactions (an update, a claim, an insert-or-ignore) race each other. READ
 * COMMITTED, PostgreSQL's default, has one that meets a row another changed meanwhile wait for it and look again;
 * under REPEATABLE READ or SERIALIZABLE it would fail with a serialization error instead. A store's readiness checks
 * it first.
 */
export async function assertReadCommittedDefault(db: SqlTransaction, storeName: string): Promise<void> {
  const [row] = await db.query<{ isolation: string }>("SELECT current_setting('default_transaction_isolation') AS isolation");
  if (row?.isolation !== 'read committed') {
    throw new Error(
      `${storeName} needs the database's default transaction isolation to be READ COMMITTED (PostgreSQL's default), not ${row?.isolation}: ` +
        'its statements race each other, and would fail with serialization errors. Set default_transaction_isolation back for the database, ' +
        "or for the store's connections (a pool of their own).",
    );
  }
}
