import type {
  SqlExecuteResult,
  SqlExecutor as AnySqlExecutor,
  SqlTransaction as AnySqlTransaction,
  SqlTransactionOptions,
} from '../../interfaces/sql-executor.interface.js';

/**
 * Runs SQL on one transaction's connection on MySQL: what `SqlExecutor.transaction()` hands its callback, and what
 * `SqlExecutor.wrapTransaction()` makes of the application's own transaction object. `?` placeholders, bound in
 * order; `execute()` counts the rows a write touched, as MySQL has no `RETURNING`.
 *
 * ```ts
 * const tx = executor.wrapTransaction(applicationTx);
 * const { affectedRows } = await tx.execute('UPDATE nest_queues_jobs SET state = ? WHERE id = ? AND state = ?', ['active', id, 'waiting']);
 * ```
 */
export interface SqlTransaction extends AnySqlTransaction {
  /**
   * Runs one statement that writes (INSERT, UPDATE, DELETE), with its `?` placeholders bound to `params` in order, and
   * resolves to the rows it inserted or deleted, or, for an UPDATE, the rows it matched (changed or not). Don't read
   * it for `INSERT ... ON DUPLICATE KEY UPDATE`: MySQL counts an insert and an unchanged duplicate alike (1).
   */
  execute(text: string, params?: readonly unknown[]): Promise<SqlExecuteResult>;
}

/**
 * How a MySQL store reaches its database through the client the application already has: `fromMysql2()`,
 * `fromDrizzle()`, `fromTypeOrm()`, `fromPrisma()` and `fromKysely()` from `@nestjs/store-kit/mysql` make one of a
 * pool or an ORM. Statements take `?` placeholders; `execute()` counts the rows a write touched. A transaction's
 * isolation level applies to that transaction alone (`SET TRANSACTION ISOLATION LEVEL` before it starts), never to
 * the connection: the pool is the application's.
 *
 * ```ts
 * const executor = fromMysql2(pool);
 * const [job] = await executor.query<{ id: string }>('SELECT id FROM nest_queues_jobs WHERE state = ? LIMIT 1', ['waiting']);
 * await executor.transaction(async (tx) => {
 *   await tx.execute('UPDATE nest_queues_jobs SET state = ? WHERE id = ?', ['active', job.id]);
 * }, { isolationLevel: 'read committed' });
 * ```
 *
 * It's the root's `SqlExecutor<'mysql'>` with `execute()` required: a MySQL store's options take it, and a PostgreSQL
 * executor there is a compile error. `SqlExecutor<'mysql'>` names the same type, as a PostgreSQL store's options name
 * theirs `SqlExecutor<'postgres'>`.
 */
export interface SqlExecutor<D extends 'mysql' = 'mysql'> extends AnySqlExecutor<D> {
  readonly dialect: D;
  /** Runs one statement that writes, outside any transaction, as `SqlTransaction.execute()`. */
  execute(text: string, params?: readonly unknown[]): Promise<SqlExecuteResult>;
  transaction<T>(work: (transaction: SqlTransaction) => Promise<T>, options?: SqlTransactionOptions): Promise<T>;
  wrapTransaction(transaction: unknown): SqlTransaction;
}
