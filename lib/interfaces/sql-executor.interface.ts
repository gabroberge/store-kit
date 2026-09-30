/**
 * A transaction isolation level: the four of the SQL standard, which PostgreSQL and MySQL share.
 *
 * ```ts
 * const isolationLevel: SqlIsolationLevel = 'read committed';
 * ```
 */
export type SqlIsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

/**
 * What `SqlExecutor.transaction()` takes.
 *
 * ```ts
 * await executor.transaction((tx) => tx.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', ['emails']), { isolationLevel: 'read committed' });
 * ```
 */
export interface SqlTransactionOptions {
  /** Default: the database's (PostgreSQL's `default_transaction_isolation`, `read committed` unless changed). */
  isolationLevel?: SqlIsolationLevel;
}

/**
 * Runs SQL on one transaction's connection: what `SqlExecutor.transaction()` hands its callback, and what
 * `SqlExecutor.wrapTransaction()` makes of the application's own transaction object.
 *
 * ```ts
 * const tx = executor.wrapTransaction(applicationTx);
 * await tx.query('INSERT INTO nest_queues.jobs (id, data) VALUES ($1::text, $2::text::jsonb)', [id, JSON.stringify(data)]);
 * ```
 */
export interface SqlTransaction {
  /**
   * Runs one statement, with its placeholders (`$1`, `$2`... on PostgreSQL) bound to `params` in order, and resolves
   * to its rows (`[]` for a statement that returns none).
   */
  query<R extends object = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<R[]>;
}

/**
 * How a store reaches its database through the client the application already has. `fromPg()`, `fromDrizzle()`,
 * `fromTypeOrm()`, `fromPrisma()` and `fromKysely()` from `@nestjs/store-kit/postgres` make one of a pool or an ORM;
 * anything else can implement it (`sqlExecutorContract()` from `@nestjs/store-kit/testing` checks one). Nothing in it
 * belongs to a store: every first-party store of a dialect takes the same executors, and with them the same
 * transaction objects.
 *
 * ```ts
 * const executor = fromDrizzle(db);
 * const [job] = await executor.query<{ id: string }>('SELECT id FROM nest_queues.jobs WHERE state = $1::text LIMIT 1', ['waiting']);
 * await executor.transaction(async (tx) => {
 *   await tx.query('UPDATE nest_queues.jobs SET state = $1::text WHERE id = $2::text', ['active', job.id]);
 * });
 * ```
 */
export interface SqlExecutor {
  /**
   * The database it runs on, which decides the SQL it takes: a store refuses an executor of another dialect (a
   * PostgreSQL store's statements can't run on MySQL).
   */
  readonly dialect: 'postgres' | 'mysql';
  /** Runs one statement outside any transaction (on a pool, on any of its connections), as `SqlTransaction.query()`. */
  query<R extends object = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<R[]>;
  /**
   * Runs `work` in a transaction of its own, on one connection: commits when `work` resolves, rolls back and rethrows
   * when it rejects.
   */
  transaction<T>(work: (transaction: SqlTransaction) => Promise<T>, options?: SqlTransactionOptions): Promise<T>;
  /**
   * The application's transaction object (Drizzle's `tx`, a TypeORM `EntityManager`, a Prisma transaction client, a
   * Kysely `Transaction`, a node-postgres client after `BEGIN`), so statements run in it and commit or roll back with
   * the application's own writes. Throws a `TypeError` for anything else, such as the database or pool itself.
   */
  wrapTransaction(transaction: unknown): SqlTransaction;
}
