import type { SqlTransaction } from '../../interfaces/sql-executor.interface.js';

/**
 * What `advisoryLock()` takes besides the keys.
 *
 * ```ts
 * await advisoryLock(tx, keys, { namespace: `@nestjs/outbox:${schema}:key` });
 * ```
 */
export interface AdvisoryLockOptions {
  /** Shared locks exclude exclusive ones, not each other. Default: `false` (exclusive). */
  shared?: boolean;
  /**
   * Takes the locks in PostgreSQL's other advisory lock space, `pg_advisory_xact_lock(hashtext(namespace),
   * hashtext(key))`: the two-key form's locks never meet the one-key form's (the space the kit's migration lock and
   * a namespace-less call use), nor another namespace's. Use one for keys without bound (a message's key, an
   * aggregate's id): a 32-bit hash of one of them may equal the hash of a store's fixed lock, and make unrelated work
   * wait. Default: none, the one-key form.
   */
  namespace?: string;
}

/**
 * Takes transaction-scoped advisory locks (`pg_advisory_xact_lock(hashtext(key))`), held until the transaction ends:
 * no session state, so they work behind a transaction-pooling PgBouncer, and nothing can leak a lock. Several keys are
 * taken by one statement, in the order of their lock numbers (their hashes), each lock once: two transactions locking
 * overlapping sets can't deadlock, even through keys whose hashes collide. `shared` locks exclude exclusive ones, not
 * each other. Key them `<package>:<schema>:<what>`, so two stores, or two schemas of one, never share a lock, and give
 * keys without bound a `namespace` of their own (see `AdvisoryLockOptions.namespace`).
 *
 * ```ts
 * await executor.transaction(async (tx) => {
 *   await advisoryLock(tx, messages.map((message) => message.key), { namespace: `@nestjs/outbox:${schema}:key` });
 *   // insert the messages: a key's writers take turns until each commits
 * });
 * ```
 */
export async function advisoryLock(transaction: SqlTransaction, keys: string | readonly string[], options: AdvisoryLockOptions = {}): Promise<void> {
  const { namespace } = options;
  if (namespace !== undefined && typeof namespace !== 'string') {
    throw new TypeError(`advisoryLock() takes a string namespace, not ${JSON.stringify(namespace)}.`);
  }

  const lock = `pg_advisory_xact_lock${options.shared ? '_shared' : ''}`;
  const unique = typeof keys === 'string' ? [keys] : [...new Set(keys)];
  if (unique.length === 0) {
    return;
  }
  if (unique.length === 1) {
    // One key: the statement the kit's migration lock has always sent.
    await transaction.query(
      namespace === undefined ? `SELECT ${lock}(hashtext($1::text))::text AS locked` : `SELECT ${lock}(hashtext($1::text), hashtext($2::text))::text AS locked`,
      namespace === undefined ? unique : [namespace, unique[0]],
    );
    return;
  }

  // Several: ordered by the lock numbers, not the keys' text, as two texts can hash to one lock; PostgreSQL evaluates
  // the lock function after the ORDER BY sort (9.6 and later).
  await transaction.query(
    `SELECT ${namespace === undefined ? `${lock}(k.h)` : `${lock}(hashtext($2::text), k.h)`}::text AS locked
FROM (SELECT DISTINCT hashtext(t.key) AS h FROM jsonb_array_elements_text($1::text::jsonb) AS t(key)) AS k
ORDER BY k.h`,
    namespace === undefined ? [JSON.stringify(unique)] : [JSON.stringify(unique), namespace],
  );
}
