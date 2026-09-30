import { randomUUID } from 'node:crypto';
import type { SqlExecutor } from '../interfaces/sql-executor.interface.js';
import { show } from './assertions.js';
import { POSTGRES_CASES } from './postgres-executor.cases.js';

/**
 * An executor under test, with what the contract needs besides: the application's own transactions and root object
 * on the same client.
 *
 * ```ts
 * const target: SqlExecutorContractTarget = { executor: fromDrizzle(db), transaction: (work) => db.transaction(work), root: db };
 * ```
 */
export interface SqlExecutorContractTarget {
  executor: SqlExecutor;
  /**
   * Runs `work` in a transaction of the application's, the way an application does with this client, and hands
   * `work` the client's own transaction object: `(work) => db.transaction(work)`.
   */
  transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T>;
  /** What an application might pass by mistake instead of its transaction (the pool, the database, the client). */
  root: unknown;
}

/**
 * What `sqlExecutorContract()` takes besides the targets.
 *
 * ```ts
 * sqlExecutorContract(open, { dispose: (target) => pool.end() });
 * ```
 */
export interface SqlExecutorContractOptions {
  /** Called after each case with the target `createTarget` returned (end its pool, say). */
  dispose?: (target: SqlExecutorContractTarget) => unknown;
}

/**
 * One case of the contract, for any test runner.
 *
 * ```ts
 * for (const c of sqlExecutorContract(open)) {
 *   it(c.name, c.run);
 * }
 * ```
 */
export interface SqlExecutorContractCase {
  name: string;
  /** Throws on failure. */
  run(): Promise<void>;
}

const CASES = {
  statements: 'query() binds its parameters in order, passes strings through as they are, and resolves to the rows ([] for none)',
  transactions: 'transaction() commits when its work resolves, with its result, and rolls back when it rejects, with its error',
  isolation: "transaction() runs at the isolation level asked for, at the database's default without one, and refuses an unknown level",
  joins: "wrapTransaction() joins the application's transaction, and refuses its database, pool or client and anything else",
  connections: 'transactions keep to one connection while other statements and transactions run at once',
  values: 'values keep their types through SqlParams and columns(): text, integers, bigints, booleans, JSON and nulls',
} as const;

/** A case's name, shared by the dialects. */
export type ContractCaseKey = keyof typeof CASES;

/** The contract in one dialect's SQL: a scratch table's statements and each case. */
export interface DialectCases {
  createTable(table: string): string;
  dropTable(table: string): string;
  cases: Record<ContractCaseKey, (target: SqlExecutorContractTarget, table: string) => Promise<void>>;
}

/** The dialects the contract covers, by an executor's `dialect`. */
const DIALECTS: Partial<Record<SqlExecutor['dialect'], DialectCases>> = {
  postgres: POSTGRES_CASES,
};

/**
 * The `SqlExecutor` contract as test cases, for any test runner: what an executor for a client the kit doesn't cover
 * (MikroORM, postgres.js...) must do. Statements with their parameters, transactions that commit and roll back,
 * isolation levels, joining the application's transaction (and refusing its pool or database), transactions that keep
 * to one connection while others run at once, and values that round-trip through `SqlParams` and `columns()`.
 * `createTarget` is called once per case; each case creates a table of its own in the connection's default schema, and
 * drops it. The cases run in the SQL of the executor's `dialect`.
 *
 * ```ts
 * const cases = sqlExecutorContract(async () => ({
 *   executor: fromMikroOrm(orm),
 *   transaction: (work) => orm.em.transactional((em) => work(em)),
 *   root: orm.em,
 * }));
 * for (const c of cases) {
 *   it(c.name, c.run);
 * }
 * ```
 */
export function sqlExecutorContract(
  createTarget: () => SqlExecutorContractTarget | Promise<SqlExecutorContractTarget>,
  options: SqlExecutorContractOptions = {},
): SqlExecutorContractCase[] {
  return (Object.keys(CASES) as ContractCaseKey[]).map((key) => ({
    name: CASES[key],
    run: async () => {
      const target = await createTarget();
      try {
        const dialect = DIALECTS[target.executor?.dialect];
        if (!dialect) {
          throw new Error(
            `sqlExecutorContract() covers ${Object.keys(DIALECTS).join(', ')} executors; this one's dialect is ${show(target.executor?.dialect)}.`,
          );
        }

        const table = `sql_executor_contract_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        await target.executor.query(dialect.createTable(table));
        try {
          await dialect.cases[key](target, table);
        } finally {
          await target.executor.query(dialect.dropTable(table)).catch(() => undefined);
        }
      } finally {
        await options.dispose?.(target);
      }
    },
  }));
}
