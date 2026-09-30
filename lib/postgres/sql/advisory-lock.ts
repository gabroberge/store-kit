import type { SqlTransaction } from '../../interfaces/sql-executor.interface.js';

/**
 * Takes transaction-scoped advisory locks (`pg_advisory_xact_lock(hashtext(key))`), held until the transaction ends:
 * no session state, so they work behind a transaction-pooling PgBouncer, and nothing can leak a lock. Several keys are
 * taken one after another in sorted order, each once, so two transactions locking overlapping sets can't deadlock.
 * `shared` locks exclude exclusive ones, not each other. Key them `<package>:<schema>:<what>`, so two stores, or two
 * schemas of one, never share a lock.
 *
 * ```ts
 * await executor.transaction(async (tx) => {
 *   await advisoryLock(tx, messages.map((message) => `@nestjs/outbox:${schema}:key:${message.key}`));
 *   // insert the messages: a key's writers take turns until each commits
 * });
 * ```
 */
export async function advisoryLock(transaction: SqlTransaction, keys: string | readonly string[], options: { shared?: boolean } = {}): Promise<void> {
  const statement = `SELECT pg_advisory_xact_lock${options.shared ? '_shared' : ''}(hashtext($1::text))::text AS locked`;
  for (const key of typeof keys === 'string' ? [keys] : [...new Set(keys)].sort()) {
    await transaction.query(statement, [key]);
  }
}
