import type { SqlExecuteResult, SqlExecutor, SqlTransaction, SqlTransactionOptions } from '../../interfaces/sql-executor.interface.js';
import { notATransaction } from '../../sql/not-a-transaction.js';
import { describeValue, hasMethod, isolationSql } from '../../utils/executor.util.js';

/** The part of a node-postgres client the executor uses. Sequelize's PostgreSQL manager checks one of these out. */
interface PgClientLike {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown; rowCount?: number | null }>;
  getTransactionStatus?: () => string | null;
}

/**
 * The part of a Sequelize instance (`sequelize` with `dialect: 'postgres'`) the executor uses. There is no
 * `FOUND_ROWS` flag on PostgreSQL: `execute()` counts `rowCount`, which already counts the rows a statement matched.
 */
export interface SequelizeLike {
  getDialect?: () => string;
  options?: { dialect?: string };
  transaction<T>(options: { isolationLevel?: string }, work: (transaction: unknown) => Promise<T>): Promise<T>;
  connectionManager: {
    getConnection(query: { type: 'write'; useMaster: true }): Promise<unknown>;
    releaseConnection(connection: unknown): unknown;
  };
}

/**
 * A `SqlExecutor` on a Sequelize PostgreSQL instance. The transaction object is what `sequelize.transaction()` hands
 * its callback. Sequelize 6 keeps that transaction's connection on a field that is not in its public types; Sequelize 7
 * exposes `getConnection()`. This executor uses that method when it returns an object, and the field otherwise, then
 * runs the store's `$1` statements on that node-postgres client.
 *
 * ```ts
 * const sequelize = new Sequelize(process.env.DATABASE_URL!, { dialect: 'postgres' });
 * const executor = fromSequelize(sequelize); // a first-party store's `executor` option
 *
 * await sequelize.transaction(async (transaction) => {
 *   await sequelize.query('INSERT INTO orders (id, status) VALUES (:id, :status)', {
 *     replacements: { id: order.id, status: 'placed' },
 *     transaction,
 *   });
 *   // What a store does with the { transaction } you pass it: its writes commit or roll back with yours
 *   await executor.wrapTransaction(transaction).query('INSERT INTO audit (order_id) VALUES ($1::text)', [order.id]);
 * });
 * ```
 */
export function fromSequelize(sequelize: SequelizeLike): SqlExecutor<'postgres'> {
  const dialect = dialectOf(sequelize);
  if (!isSequelize(sequelize) || dialect !== 'postgres') {
    throw new TypeError(
      dialect && dialect !== 'postgres'
        ? `fromSequelize() takes a Sequelize instance with dialect: 'postgres', not '${dialect}'` +
            (dialect === 'mysql' ? ": a MySQL store takes that, through fromSequelize() from its package's /mysql subpath." : '.')
        : `fromSequelize() takes a Sequelize instance with dialect: 'postgres', got ${describeValue(sequelize)}.`,
    );
  }
  return new SequelizeExecutor(sequelize);
}

class SequelizeExecutor implements SqlExecutor<'postgres'> {
  readonly dialect = 'postgres';

  constructor(private readonly sequelize: SequelizeLike) {}

  query<R extends object>(text: string, params: readonly unknown[] = []): Promise<R[]> {
    return withWriteConnection(this.sequelize, (connection) => rows<R>(connection, text, params));
  }

  execute(text: string, params: readonly unknown[] = []): Promise<SqlExecuteResult> {
    return withWriteConnection(this.sequelize, (connection) => written(connection, text, params));
  }

  async transaction<T>(work: (transaction: SqlTransaction) => Promise<T>, options: SqlTransactionOptions = {}): Promise<T> {
    const isolationLevel = options.isolationLevel ? isolationSql(options.isolationLevel) : undefined;
    // PostgreSQL's dialect starts the transaction, then `SET TRANSACTION ISOLATION LEVEL` for that transaction alone.
    // `async` so an unknown level rejects the returned promise, as the other executors do.
    return this.sequelize.transaction(isolationLevel ? { isolationLevel } : {}, (transaction) => work(sequelizeTransaction(transaction)));
  }

  wrapTransaction(transaction: unknown): SqlTransaction {
    return sequelizeTransaction(transaction);
  }
}

/** A Sequelize transaction that has checked out its connection: not a savepoint, not the instance. */
interface OpenTransaction {
  id: string;
  commit: () => unknown;
  rollback: () => unknown;
  finished?: string;
  parent?: unknown;
  connection?: object;
  getConnection?: () => unknown;
}

function sequelizeTransaction(transaction: unknown): SqlTransaction {
  if (isSequelize(transaction)) {
    throw notATransaction('Pass the transaction your sequelize.transaction() callback receives, not the Sequelize instance: a statement on the instance runs outside your transaction.');
  }

  const open = asOpenTransaction(transaction);
  if (!open) {
    throw notATransaction(`Pass the transaction your sequelize.transaction() callback receives, got ${describeValue(transaction)}.`);
  }
  if (open.parent) {
    throw notATransaction(
      'Pass the transaction your sequelize.transaction() callback receives, not a savepoint: its statements would run on the outer transaction and survive a rollback to the savepoint.',
    );
  }

  const pooled = checkedOutConnection(open);
  if (!pooled) {
    throw notATransaction('The Sequelize transaction has no connection yet: wait until sequelize.transaction() calls back.');
  }
  if (isReadReplica(pooled)) {
    throw notATransaction("Pass a transaction on the primary, not a read replica: the store's statements write.");
  }

  const connection = asPg(pooled);
  return {
    query: async <R extends object>(text: string, params: readonly unknown[] = []) => {
      assertInTransaction(connection, open.finished);
      return rows<R>(connection, text, params);
    },
    execute: async (text: string, params: readonly unknown[] = []) => {
      assertInTransaction(connection, open.finished);
      return written(connection, text, params);
    },
  };
}

function isSequelize(value: unknown): value is SequelizeLike {
  return typeof value === 'object' && value !== null && hasMethod(value, 'transaction') && hasMethod((value as { connectionManager?: unknown }).connectionManager, 'getConnection');
}

function dialectOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as SequelizeLike;
  if (typeof candidate.getDialect === 'function') {
    return candidate.getDialect();
  }
  return candidate.options?.dialect;
}

function asOpenTransaction(value: unknown): OpenTransaction | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Partial<OpenTransaction>;
  if (typeof candidate.id !== 'string' || !hasMethod(candidate, 'commit') || !hasMethod(candidate, 'rollback')) {
    return undefined;
  }
  return candidate as OpenTransaction;
}

function checkedOutConnection(transaction: OpenTransaction): object | undefined {
  if (typeof transaction.getConnection === 'function') {
    const got: unknown = transaction.getConnection();
    if (typeof got === 'object' && got !== null) {
      return got;
    }
  }
  return transaction.connection;
}

function isReadReplica(connection: object): boolean {
  return 'queryType' in connection && (connection as { queryType?: unknown }).queryType === 'read';
}

function asPg(connection: object): PgClientLike {
  if (!hasMethod(connection, 'query')) {
    throw new TypeError('Sequelize did not check out a PostgreSQL connection.');
  }
  return connection as PgClientLike;
}

/**
 * node-postgres 8.21 reports a client's transaction: `T` in one, `E` in a failed one, anything else idle. An older
 * client has no such method; `finished` is still read on every statement.
 */
function assertInTransaction(connection: PgClientLike, finished: string | undefined): void {
  if (finished) {
    throw notATransaction(`The Sequelize transaction is already finished (${finished}).`);
  }
  if (typeof connection.getTransactionStatus !== 'function') {
    return;
  }
  const status = connection.getTransactionStatus();
  if (status === 'E') {
    throw notATransaction("The Sequelize transaction's connection is in a failed transaction: roll it back.");
  }
  if (status !== 'T') {
    throw notATransaction("The Sequelize connection isn't in a transaction: call sequelize.transaction() first, or each statement commits on its own.");
  }
}

async function withWriteConnection<T>(sequelize: SequelizeLike, work: (connection: PgClientLike) => Promise<T>): Promise<T> {
  const connection = await sequelize.connectionManager.getConnection({ type: 'write', useMaster: true });
  if (typeof connection !== 'object' || connection === null) {
    throw new TypeError('Sequelize did not check out a PostgreSQL connection.');
  }

  try {
    return await work(asPg(connection));
  } finally {
    await sequelize.connectionManager.releaseConnection(connection);
  }
}

async function rows<R extends object>(connection: PgClientLike, text: string, params: readonly unknown[]): Promise<R[]> {
  const result = await connection.query(text, [...params]);
  return (Array.isArray(result.rows) ? result.rows : []) as R[];
}

async function written(connection: PgClientLike, text: string, params: readonly unknown[]): Promise<SqlExecuteResult> {
  const result = await connection.query(text, [...params]);
  return { affectedRows: result.rowCount ?? 0 };
}
