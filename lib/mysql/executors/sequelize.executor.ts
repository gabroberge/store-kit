import type {
  SqlExecuteResult,
  SqlTransactionOptions,
} from '../../interfaces/sql-executor.interface.js';
import { notATransaction } from '../../sql/not-a-transaction.js';
import {
  describeValue,
  hasMethod,
  isolationSql,
} from '../../utils/executor.util.js';
import type {
  SqlExecutor,
  SqlTransaction,
} from '../interfaces/mysql-executor.interface.js';
import {
  assertFoundRows,
  checkPlaceholders,
  mysql2Flags,
} from './mysql-client.util.js';

/** The part of a mysql2 connection the executor uses, promise API or callback API. */
interface Mysql2ConnectionLike {
  query(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>;
}

/**
 * The part of a Sequelize instance (`sequelize` with `dialect: 'mysql'`) the executor uses. Sequelize's MySQL
 * connection manager sets `flags: "-FOUND_ROWS"` and then copies `dialectOptions` over that default, so an instance
 * keeps mysql2's own default (which includes `FOUND_ROWS`) only when `dialectOptions.flags` replaces it, for example
 * `dialectOptions: { flags: '' }`. The flag is chosen when the connection opens.
 */
export interface SequelizeLike {
  getDialect?: () => string;
  options?: { dialect?: string; dialectOptions?: { flags?: unknown } };
  transaction<T>(
    options: { isolationLevel?: string },
    work: (transaction: unknown) => Promise<T>,
  ): Promise<T>;
  connectionManager: {
    getConnection(query: { type: 'write'; useMaster: true }): Promise<unknown>;
    releaseConnection(connection: unknown): unknown;
  };
}

/**
 * A `SqlExecutor` on a Sequelize MySQL instance. The transaction object is what `sequelize.transaction()` hands its
 * callback. A pool or connection configured without the `FOUND_ROWS` client flag is refused: a store's `execute()`
 * counts the rows an UPDATE matched. Sequelize turns that flag off unless `dialectOptions.flags` overrides it.
 *
 * ```ts
 * const sequelize = new Sequelize(process.env.DATABASE_URL!, {
 *   dialect: 'mysql',
 *   dialectOptions: { flags: '' }, // keep mysql2's default FOUND_ROWS; Sequelize would pass "-FOUND_ROWS"
 * });
 * const executor = fromSequelize(sequelize); // a first-party store's `executor` option
 *
 * await sequelize.transaction(async (transaction) => {
 *   await sequelize.query('INSERT INTO orders (id, status) VALUES (:id, :status)', {
 *     replacements: { id: order.id, status: 'placed' },
 *     transaction,
 *   });
 *   // What a store does with the { transaction } you pass it: its writes commit or roll back with yours
 *   await executor.wrapTransaction(transaction).execute('INSERT INTO audit (order_id) VALUES (?)', [order.id]);
 * });
 * ```
 *
 * Sequelize 6 keeps the connection of an open transaction on a field that is not in its public types. Sequelize 7
 * exposes `getConnection()`. This executor uses that method when it returns an object, and the field otherwise.
 */
export function fromSequelize(sequelize: SequelizeLike): SqlExecutor {
  const dialect = dialectOf(sequelize);
  if (!isSequelize(sequelize) || dialect !== 'mysql') {
    throw new TypeError(
      dialect && dialect !== 'mysql'
        ? `fromSequelize() takes a Sequelize instance with dialect: 'mysql', not '${dialect}'` +
            (dialect === 'postgres'
              ? ": a PostgreSQL store takes that, through fromSequelize() from its package's /postgres subpath."
              : '.')
        : `fromSequelize() takes a Sequelize instance with dialect: 'mysql', got ${describeValue(sequelize)}.`,
    );
  }

  if (foundRowsDisabled(sequelize)) {
    throw new TypeError(
      "fromSequelize() needs mysql2's FOUND_ROWS client flag, which it sets by default: without it, an UPDATE counts the rows it changed instead of the rows it matched. " +
        'Sequelize\'s MySQL connection manager sets flags to "-FOUND_ROWS" and then copies dialectOptions over that default, so pass dialectOptions: { flags: "" } on this Sequelize instance. ' +
        'The flag is chosen when the connection opens.',
    );
  }

  return new SequelizeExecutor(sequelize);
}

class SequelizeExecutor implements SqlExecutor {
  readonly dialect = 'mysql';

  constructor(private readonly sequelize: SequelizeLike) {}

  query<R extends object>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<R[]> {
    return withWriteConnection(this.sequelize, (connection) =>
      rows<R>(connection, text, params),
    );
  }

  execute(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<SqlExecuteResult> {
    return withWriteConnection(this.sequelize, (connection) =>
      written(connection, text, params),
    );
  }

  async transaction<T>(
    work: (transaction: SqlTransaction) => Promise<T>,
    options: SqlTransactionOptions = {},
  ): Promise<T> {
    const isolationLevel = options.isolationLevel
      ? isolationSql(options.isolationLevel)
      : undefined;
    // Sequelize sends `SET TRANSACTION ISOLATION LEVEL` (the next transaction's alone) before `START TRANSACTION`.
    // `async` so an unknown level rejects the returned promise, as the other executors do.
    return this.sequelize.transaction(
      isolationLevel ? { isolationLevel } : {},
      (transaction) => work(sequelizeTransaction(transaction)),
    );
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
    throw notATransaction(
      'Pass the transaction your sequelize.transaction() callback receives, not the Sequelize instance: a statement on the instance runs outside your transaction.',
    );
  }

  const open = asOpenTransaction(transaction);
  if (!open) {
    throw notATransaction(
      `Pass the transaction your sequelize.transaction() callback receives, got ${describeValue(transaction)}.`,
    );
  }
  if (open.parent) {
    throw notATransaction(
      'Pass the transaction your sequelize.transaction() callback receives, not a savepoint: its statements would run on the outer transaction and survive a rollback to the savepoint.',
    );
  }

  const pooled = checkedOutConnection(open);
  if (!pooled) {
    throw notATransaction(
      'The Sequelize transaction has no connection yet: wait until sequelize.transaction() calls back.',
    );
  }
  if (isReadReplica(pooled)) {
    throw notATransaction(
      "Pass a transaction on the primary, not a read replica: the store's statements write.",
    );
  }

  assertFoundRows(mysql2Flags(pooled), 'fromSequelize()');
  const connection = promised(pooled);
  // The server flag is read once. A store's migrations `COMMIT` inside the callback, then run DDL and `GET_LOCK` on
  // the same connection. Checking every statement would refuse that path. `finished` is still read on every statement.
  let checked: Promise<void> | undefined;
  const inTransaction = async () => {
    if (open.finished) {
      throw notATransaction(
        `The Sequelize transaction is already finished (${open.finished}).`,
      );
    }
    checked ??= assertInTransaction(connection);
    await checked;
  };

  return {
    query: async <R extends object>(
      text: string,
      params: readonly unknown[] = [],
    ) => {
      await inTransaction();
      return rows<R>(connection, text, params);
    },
    execute: async (text: string, params: readonly unknown[] = []) => {
      await inTransaction();
      return written(connection, text, params);
    },
  };
}

function isSequelize(value: unknown): value is SequelizeLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasMethod(value, 'transaction') &&
    hasMethod(
      (value as { connectionManager?: unknown }).connectionManager,
      'getConnection',
    )
  );
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

/**
 * Sequelize's manager sets `"-FOUND_ROWS"` unless `dialectOptions.flags` replaces that property. A missing `flags` is
 * the default, which turns the capability off. mysql2 treats `-found_rows` the same as `-FOUND_ROWS`.
 */
function foundRowsDisabled(sequelize: SequelizeLike): boolean {
  const flags = sequelize.options?.dialectOptions?.flags;
  if (typeof flags === 'string') {
    return flags
      .split(',')
      .map((entry) => entry.trim().toUpperCase())
      .includes('-FOUND_ROWS');
  }
  if (Array.isArray(flags)) {
    return flags.some(
      (entry) =>
        typeof entry === 'string' && entry.toUpperCase() === '-FOUND_ROWS',
    );
  }
  return true;
}

function asOpenTransaction(value: unknown): OpenTransaction | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Partial<OpenTransaction>;
  if (
    typeof candidate.id !== 'string' ||
    !hasMethod(candidate, 'commit') ||
    !hasMethod(candidate, 'rollback')
  ) {
    return undefined;
  }
  return candidate as OpenTransaction;
}

function checkedOutConnection(
  transaction: OpenTransaction,
): object | undefined {
  if (typeof transaction.getConnection === 'function') {
    const got: unknown = transaction.getConnection();
    if (typeof got === 'object' && got !== null) {
      return got;
    }
  }
  return transaction.connection;
}

function isReadReplica(connection: object): boolean {
  return (
    'queryType' in connection &&
    (connection as { queryType?: unknown }).queryType === 'read'
  );
}

/** SERVER_STATUS_IN_TRANS: the connection is in a transaction. */
const IN_TRANSACTION = 1;

async function assertInTransaction(
  connection: Mysql2ConnectionLike,
): Promise<void> {
  const [header] = await connection.query('DO 0');
  const status = (header as { serverStatus?: unknown } | undefined)
    ?.serverStatus;
  if (typeof status === 'number' && (status & IN_TRANSACTION) === 0) {
    throw notATransaction(
      "The Sequelize connection isn't in a transaction: call sequelize.transaction() first, or each statement commits on its own.",
    );
  }
}

async function withWriteConnection<T>(
  sequelize: SequelizeLike,
  work: (connection: Mysql2ConnectionLike) => Promise<T>,
): Promise<T> {
  const connection = await sequelize.connectionManager.getConnection({
    type: 'write',
    useMaster: true,
  });
  if (typeof connection !== 'object' || connection === null) {
    throw new TypeError('Sequelize did not check out a MySQL connection.');
  }

  try {
    assertFoundRows(mysql2Flags(connection), 'fromSequelize()');
    return await work(promised(connection));
  } finally {
    await sequelize.connectionManager.releaseConnection(connection);
  }
}

async function rows<R extends object>(
  connection: Mysql2ConnectionLike,
  text: string,
  params: readonly unknown[],
): Promise<R[]> {
  checkPlaceholders(text, params);
  const [result] = await connection.query(text, [...params]);
  return (Array.isArray(result) ? result : []) as R[];
}

async function written(
  connection: Mysql2ConnectionLike,
  text: string,
  params: readonly unknown[],
): Promise<SqlExecuteResult> {
  checkPlaceholders(text, params);
  const [result] = await connection.query(text, [...params]);
  return {
    affectedRows: Array.isArray(result)
      ? 0
      : Number(
          (result as { affectedRows?: unknown } | null)?.affectedRows ?? 0,
        ),
  };
}

/** The promise API of a mysql2 connection: the callback API's objects have `promise()`. */
function promised(connection: object): Mysql2ConnectionLike {
  const candidate = connection as { promise?: () => Mysql2ConnectionLike };
  return typeof candidate.promise === 'function'
    ? candidate.promise()
    : (connection as Mysql2ConnectionLike);
}
