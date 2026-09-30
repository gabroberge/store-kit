/**
 * The `code` of the `TypeError` the kit's executors throw for an object that isn't a transaction they can join (see
 * `SqlExecutor.wrapTransaction()`). Stable: stores and applications compare it, never a class.
 */
export const NOT_A_TRANSACTION = 'ERR_SQL_NOT_A_TRANSACTION';

/**
 * Whether `error` is an executor's refusal of an object that isn't a transaction it can join: the database, the pool
 * or the client instead of the transaction object, a connection outside a transaction, another dialect's transaction.
 * It's a `TypeError` whose `code` is `'ERR_SQL_NOT_A_TRANSACTION'`, thrown by `wrapTransaction()` (and by the first
 * statement of a mysql2 connection's, which only the server can check). This compares the code, never a class, so it
 * recognizes the refusal of whichever copy of the kit an application holds.
 *
 * A store method that takes the application's transaction turns it into the package's own error, and lets every other
 * error through as it is:
 *
 * ```ts
 * private inTransaction(transaction: unknown): SqlTransaction {
 *   try {
 *     return this.executor.wrapTransaction(transaction);
 *   } catch (error) {
 *     throw isNotATransactionError(error) ? new OutboxTransactionRequiredError(error.message, { cause: error }) : error;
 *   }
 * }
 * ```
 */
export function isNotATransactionError(error: unknown): error is TypeError & { code: typeof NOT_A_TRANSACTION } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === NOT_A_TRANSACTION;
}

/** The refusal `isNotATransactionError()` recognizes: a `TypeError` with the code. */
export function notATransaction(message: string): TypeError & { code: typeof NOT_A_TRANSACTION } {
  return Object.assign(new TypeError(message), { code: NOT_A_TRANSACTION } as const);
}
