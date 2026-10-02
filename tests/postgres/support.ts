/**
 * The database clients an application may hand a store (node-postgres, Sequelize, Drizzle on node-postgres and on PGlite,
 * TypeORM, Prisma, Kysely), each with the ORM's own way of running a transaction, and a database per test file on
 * PostgreSQL (`SQL_TEST_PG_URL`, else a throwaway cluster, else those tests are skipped with the reason), through
 * tests/support/postgres.ts, which names (`skit_`) and sweeps them.
 */
import { PGlite } from '@electric-sql/pglite';
import { PrismaPg } from '@prisma/adapter-pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { Sequelize, type Transaction } from 'sequelize';
import { Column, DataSource, Entity, PrimaryColumn } from 'typeorm';
import type { SqlExecutor as AnySqlExecutor, SqlDialect } from '../../lib/index.js';
import { fromDrizzle, fromKysely, fromPg, fromPrisma, fromSequelize, fromTypeOrm, type SqlExecutor } from '../../lib/postgres/index.js';
import { PrismaClient } from '../fixtures/prisma/generated/client.js';
import { endPool, startPostgres } from '../support/postgres.js';

/** The application's table, written in the same transactions as the store's rows. */
export const ORDERS_DDL = 'CREATE TABLE IF NOT EXISTS orders (id text PRIMARY KEY, status text NOT NULL)';

export type Isolation = 'read committed' | 'repeatable read';

/** A database client as an application holds one. */
export interface Client {
  name: string;
  executor: SqlExecutor<'postgres'>;
  /** A transaction as the application runs one with this client: `work` gets the ORM's own transaction object. */
  transaction<T>(work: (tx: unknown) => Promise<T>, isolation?: Isolation): Promise<T>;
  /** What an application might pass by mistake instead of its transaction: the pool, the database, the client. */
  root: unknown;
  /** The application's write, through its transaction object. */
  insertOrder(tx: unknown, id: string): Promise<void>;
  close(): Promise<void>;
}

export interface ClientFactory {
  name: string;
  open(url: string): Promise<Client>;
}

const drizzleOrders = pgTable('orders', { id: text('id').primaryKey(), status: text('status').notNull() });

@Entity('orders')
class OrderEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  status!: string;
}

interface KyselyDatabase {
  orders: { id: string; status: string };
}

export const pgClient: ClientFactory = {
  name: 'fromPg (node-postgres Pool)',
  async open(url) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    return {
      name: this.name,
      executor: fromPg(pool),
      root: pool,
      async transaction(work, isolation) {
        const client = await pool.connect();
        try {
          await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation.toUpperCase()}` : 'BEGIN');
          const result = await work(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      insertOrder: async (tx, id) => {
        await (tx as pg.PoolClient).query("INSERT INTO orders (id, status) VALUES ($1, 'placed')", [id]);
      },
      close: () => endPool(pool),
    };
  },
};

export const drizzleClient: ClientFactory = {
  name: 'fromDrizzle (node-postgres)',
  async open(url) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = drizzlePg(pool);
    return {
      name: this.name,
      executor: fromDrizzle(db),
      root: db,
      transaction: (work, isolation) => db.transaction(work, isolation ? { isolationLevel: isolation } : undefined),
      insertOrder: async (tx, id) => {
        await (tx as typeof db).insert(drizzleOrders).values({ id, status: 'placed' });
      },
      close: () => endPool(pool),
    };
  },
};

export const typeOrmClient: ClientFactory = {
  name: 'fromTypeOrm',
  async open(url) {
    const dataSource = await new DataSource({ type: 'postgres', url, entities: [OrderEntity], poolSize: 10 }).initialize();
    return {
      name: this.name,
      executor: fromTypeOrm(dataSource),
      root: dataSource.manager,
      transaction: (work, isolation) => (isolation ? dataSource.transaction(isolation.toUpperCase() as 'REPEATABLE READ', work) : dataSource.transaction(work)),
      insertOrder: async (tx, id) => {
        await (tx as DataSource['manager']).insert(OrderEntity, { id, status: 'placed' });
      },
      close: () => dataSource.destroy(),
    };
  },
};

export const prismaClient: ClientFactory = {
  name: 'fromPrisma (@prisma/adapter-pg)',
  async open(url) {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 10 }) });
    return {
      name: this.name,
      executor: fromPrisma(prisma),
      root: prisma,
      // The application's own limits: Prisma's default maxWait (2 s) is short for a busy machine.
      transaction: (work, isolation) =>
        prisma.$transaction((tx) => work(tx), {
          maxWait: 10_000,
          timeout: 30_000,
          ...(isolation ? { isolationLevel: isolation === 'repeatable read' ? 'RepeatableRead' : 'ReadCommitted' } : {}),
        }),
      insertOrder: async (tx, id) => {
        await (tx as PrismaClient).order.create({ data: { id, status: 'placed' } });
      },
      close: () => prisma.$disconnect(),
    };
  },
};

export const kyselyClient: ClientFactory = {
  name: 'fromKysely',
  async open(url) {
    const db = new Kysely<KyselyDatabase>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 10 }) }) });
    return {
      name: this.name,
      executor: fromKysely(db),
      root: db,
      transaction: (work, isolation) => (isolation ? db.transaction().setIsolationLevel(isolation).execute(work) : db.transaction().execute(work)),
      insertOrder: async (tx, id) => {
        await (tx as typeof db).insertInto('orders').values({ id, status: 'placed' }).execute();
      },
      close: () => db.destroy(),
    };
  },
};

/** Sequelize on the same server as the other clients. PostgreSQL has no `FOUND_ROWS` flag to set. */
export const sequelizeClient: ClientFactory = {
  name: 'fromSequelize',
  async open(url) {
    const sequelize = new Sequelize(url, { dialect: 'postgres', logging: false, pool: { max: 10, min: 0 } });
    return {
      name: this.name,
      executor: fromSequelize(sequelize),
      root: sequelize,
      transaction: (work, isolation) =>
        sequelize.transaction(isolation ? { isolationLevel: isolation.toUpperCase() as Transaction.ISOLATION_LEVELS } : {}, (tx) => work(tx)),
      insertOrder: async (tx, id) => {
        await sequelize.query("INSERT INTO orders (id, status) VALUES (:id, 'placed')", { replacements: { id }, transaction: tx as Transaction });
      },
      close: () => sequelize.close(),
    };
  },
};

/** Every client on PostgreSQL. */
export const clients = [pgClient, drizzleClient, typeOrmClient, prismaClient, kyselyClient, sequelizeClient];

/** Drizzle on PGlite: PostgreSQL in-process, one connection, so every transaction waits for the one before it. */
export async function openPglite(): Promise<Client & { pglite: PGlite }> {
  const pglite = new PGlite();
  const db = drizzlePglite(pglite);
  await db.execute(ORDERS_DDL);
  return {
    name: 'fromDrizzle (PGlite)',
    pglite,
    executor: fromDrizzle(db),
    root: db,
    transaction: (work, isolation) => db.transaction(work, isolation ? { isolationLevel: isolation } : undefined),
    insertOrder: async (tx, id) => {
      await (tx as typeof db).insert(drizzleOrders).values({ id, status: 'placed' });
    },
    close: () => pglite.close(),
  };
}

export interface TestDatabase {
  url: string;
  /** A client for looking at the database from outside the store. */
  admin: pg.Pool;
}

/**
 * A database of this test file on PostgreSQL (with `orders`), dropped after the file; `null`, with the reason, where
 * there's no PostgreSQL. Tests that need it skip with the reason.
 */
export async function testDatabase(name: string): Promise<{ database: TestDatabase; reason?: undefined } | { database: null; reason: string }> {
  const { postgres, reason } = await startPostgres();
  if (!postgres) {
    return { database: null, reason: `no PostgreSQL: ${reason}` };
  }

  const url = await postgres.createDatabase(name);
  const admin = new pg.Pool({ connectionString: url, max: 2 });
  await admin.query(ORDERS_DDL);
  afterAll(async () => {
    await endPool(admin);
    await postgres.stop();
  });
  return { database: { url, admin } };
}

/** In a describe of tests that run on PostgreSQL: skips them, with the reason, where there's none. */
export function onPostgres(reason: string | undefined): void {
  beforeEach((context) => {
    if (reason) {
      context.skip(reason);
    }
  });
}

/** An executor that records every statement it runs, and its parameters: of the dialect of the executor it wraps. */
export function recording<D extends SqlDialect>(executor: AnySqlExecutor<D>): { executor: AnySqlExecutor<D>; statements: Array<{ text: string; params?: readonly unknown[] }> } {
  const statements: Array<{ text: string; params?: readonly unknown[] }> = [];
  const record = (tx: { query: SqlExecutor['query'] }) => ({
    query: <R extends object>(text: string, params?: readonly unknown[]) => {
      statements.push({ text, params });
      return tx.query<R>(text, params);
    },
  });
  return {
    statements,
    executor: {
      dialect: executor.dialect,
      query: (text, params) => record(executor).query(text, params),
      transaction: (work, options) => executor.transaction((tx) => work(record(tx)), options),
      wrapTransaction: (transaction) => record(executor.wrapTransaction(transaction)),
    },
  };
}
