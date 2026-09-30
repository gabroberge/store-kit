/**
 * A store's options and readiness through StoreSchema (tests/fixtures/notes): the options checked with messages that
 * name the store (an executor of another dialect included) and defaulted by NODE_ENV; readiness that migrates once
 * for calls that arrive together, or fails while the schema is behind and tries again at the next call; the database's
 * default isolation checked first; the first call in the application's transaction checked through it, on PGlite.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import pg from 'pg';
import type { SqlExecutor as AnySqlExecutor } from '../../lib/index.js';
import { fromDrizzle, fromPg, type SqlExecutor } from '../../lib/postgres/index.js';
import { endPool } from '../support/postgres.js';
import { NoteSchemaError, noteSchema } from '../fixtures/notes/note.schema.js';
import { PostgresNoteStore } from '../fixtures/notes/postgres-note.store.js';
import { onPostgres, recording, testDatabase } from './support.js';

const { database, reason } = await testDatabase('readiness');
const pools: pg.Pool[] = [];

afterAll(async () => {
  await Promise.all(pools.map((pool) => endPool(pool)));
});

const pool = (options: pg.PoolConfig = {}) => {
  const opened = new pg.Pool({ connectionString: database!.url, max: 2, ...options });
  pools.push(opened);
  return opened;
};

const schemas = async (name: string) => (await database!.admin.query('SELECT nspname FROM pg_namespace WHERE nspname = $1', [name])).rows;

/** Runs `work` with `NODE_ENV` set to `value` (`undefined`: unset). */
async function withNodeEnv<T>(value: string | undefined, work: () => T | Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  try {
    if (value === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = value;
    }
    return await work();
  } finally {
    process.env.NODE_ENV = previous;
  }
}

describe('StoreSchema.resolveOptions()', () => {
  // Nothing connects: a pool opens its connections at the first statement.
  const executor = fromPg(new pg.Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' }));

  it('checks the executor, its dialect, migrate and the schema, with messages that name the store', () => {
    expect(() => noteSchema.resolveOptions({ executor: {} as SqlExecutor })).toThrow(
      'PostgresNoteStore: `executor` must be a SqlExecutor, such as fromPg(pool), fromDrizzle(db), fromTypeOrm(dataSource), fromPrisma(prisma) or fromKysely(db).',
    );
    expect(() => noteSchema.resolveOptions(undefined as never)).toThrow('PostgresNoteStore: `executor` must be a SqlExecutor');

    const mysql = { ...executor, dialect: 'mysql', query: executor.query, transaction: executor.transaction, wrapTransaction: executor.wrapTransaction } as AnySqlExecutor;
    expect(() => noteSchema.resolveOptions({ executor: mysql })).toThrow(
      "PostgresNoteStore runs on PostgreSQL, and `executor` is a MySQL executor: import the executor from '@nestjs/notes/postgres' (fromPg, fromDrizzle, fromTypeOrm, fromPrisma or fromKysely).",
    );
    const unmarked = { query: executor.query, transaction: executor.transaction, wrapTransaction: executor.wrapTransaction } as AnySqlExecutor;
    expect(() => noteSchema.resolveOptions({ executor: unmarked })).toThrow(
      "PostgresNoteStore: `executor` doesn't say which database it runs on: a SqlExecutor has a `dialect` ('postgres' for PostgreSQL).",
    );

    expect(() => noteSchema.resolveOptions({ executor, migrate: 'yes' as never })).toThrow('PostgresNoteStore: `migrate` must be true or false, not "yes".');
    expect(() => noteSchema.resolveOptions({ executor, schema: 'bad-name' })).toThrow(
      'PostgresNoteStore: invalid schema "bad-name". Use letters, digits and underscores, not starting with a digit, at most 63 characters.',
    );
    expect(noteSchema.resolveOptions({ executor, schema: 'shop_notes', migrate: false })).toEqual({ executor, schema: 'shop_notes', migrate: false });
  });

  it("defaults to the store's schema, and migrate to on except when NODE_ENV is production", async () => {
    expect(await withNodeEnv('production', () => noteSchema.resolveOptions({ executor }))).toEqual({ executor, schema: 'nest_notes', migrate: false });
    expect(await withNodeEnv('production', () => noteSchema.resolveOptions({ executor, migrate: true })).then((options) => options.migrate)).toBe(true);
    expect(await withNodeEnv('development', () => noteSchema.resolveOptions({ executor }).migrate)).toBe(true);
    expect(await withNodeEnv(undefined, () => noteSchema.resolveOptions({ executor }).migrate)).toBe(true);
  });
});

describe('StoreSchema.readiness()', () => {
  onPostgres(reason);

  it('migrates once for the calls that arrive together, reports it to the logger, and then costs nothing', async () => {
    const recorder = recording(fromPg(pool({ max: 4 })));
    const store = new PostgresNoteStore({ executor: recorder.executor, schema: 'r_together', migrate: true });
    expect(await Promise.all(Array.from({ length: 5 }, (_, i) => store.get(`n-${i}`)))).toEqual([null, null, null, null, null]);
    expect(store.logged).toEqual(['PostgresNoteStore: migrated schema "r_together" to version 2.']);
    expect(recorder.statements.filter((statement) => statement.text.startsWith('SELECT pg_advisory_xact_lock'))).toHaveLength(1);

    recorder.statements.length = 0;
    await store.get('n-1');
    expect(recorder.statements.map((statement) => statement.text)).toEqual([expect.stringMatching(/^SELECT n\.id::text AS id/)]);
  });

  it("fails while the schema is behind with migrate off, with the package's error, changing nothing, and tries again at the next call", async () => {
    const behind = new PostgresNoteStore({ executor: fromPg(pool()), schema: 'r_behind', migrate: false });
    const error = await behind.onModuleInit().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoteSchemaError);
    expect(error).toMatchObject({ schema: 'r_behind', version: 0, requiredVersion: 2 });
    expect((error as Error).message).toMatch(/^PostgresNoteStore: schema "r_behind" is at version 0, and this version of @nestjs\/notes needs version 2\. Apply its migrations/);
    await expect(behind.get('any')).rejects.toThrow(NoteSchemaError);
    expect(await schemas('r_behind')).toEqual([]);
    expect(behind.logged).toEqual([]);

    await noteSchema.migrate(fromPg(pool()), 'r_behind');
    expect(await behind.get('any')).toBeNull();
  });

  it('migrate() applies the pending migrations whatever migrate says, and reports what it applied', async () => {
    const store = new PostgresNoteStore({ executor: fromPg(pool()), schema: 'r_explicit', migrate: false });
    expect(await store.migrate()).toEqual([1, 2]);
    expect(await store.migrate()).toEqual([]);
    expect(store.logged).toEqual(['PostgresNoteStore: migrated schema "r_explicit" to version 2.']);
    await expect(store.onModuleInit()).resolves.toBeUndefined();
  });

  it("refuses a connection whose default isolation isn't READ COMMITTED, before migrating: the store's races would fail there", async () => {
    const serializable = pool({ max: 1, options: '-c default_transaction_isolation=serializable' });
    const store = new PostgresNoteStore({ executor: fromPg(serializable), schema: 'r_isolation' });
    await expect(store.onModuleInit()).rejects.toThrow(
      "PostgresNoteStore needs the database's default transaction isolation to be READ COMMITTED (PostgreSQL's default), not serializable: its statements race each other, " +
        "and would fail with serialization errors. Set default_transaction_isolation back for the database, or for the store's connections (a pool of their own).",
    );
    await expect(store.get('any')).rejects.toThrow('not serializable');
    expect(await schemas('r_isolation')).toEqual([]);
  });

  it("doesn't migrate by default with NODE_ENV=production, and does otherwise", async () => {
    const store = (schema: string) => new PostgresNoteStore({ executor: fromPg(pool()), schema });
    await withNodeEnv('production', async () => {
      await expect(store('r_production').onModuleInit()).rejects.toThrow(NoteSchemaError);
    });
    await withNodeEnv('development', async () => {
      await expect(store('r_production').onModuleInit()).resolves.toBeUndefined();
    });
    await withNodeEnv(undefined, async () => {
      await expect(store('r_unset').onModuleInit()).resolves.toBeUndefined();
    });
  });
});

describe("a first call inside the application's transaction, on PGlite", () => {
  it("checks the schema through that transaction instead of waiting for it, and can't migrate in it", async () => {
    const pglite = new PGlite();
    const db = drizzle(pglite);
    try {
      const note = { id: 'n-1', body: 'hello', createdAt: 1 };
      const unmigrated = new PostgresNoteStore({ executor: fromDrizzle(db) });
      await expect(db.transaction((tx) => unmigrated.addInTransaction(tx, note))).rejects.toThrow(
        'PostgresNoteStore: schema "nest_notes" is at version 0, and this version of @nestjs/notes needs version 2. ' +
          "The store applies its migrations when the application starts (onModuleInit), or at its first call outside a transaction: it can't apply them in yours.",
      );
      expect(unmigrated.logged).toEqual([]);

      await new PostgresNoteStore({ executor: fromDrizzle(db) }).migrate();
      const fresh = new PostgresNoteStore({ executor: fromDrizzle(db) });
      expect(await db.transaction((tx) => fresh.addInTransaction(tx, note))).toBe(true);
      expect(await fresh.get('n-1')).toMatchObject({ body: 'hello', archived: false });
    } finally {
      await pglite.close();
    }
  });
});
