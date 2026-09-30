/**
 * The helpers a store writes its statements with: SqlParams' casts and values, columns() and the readers of its text,
 * quoteSchema(), and advisoryLock()'s locks (held until the transaction ends, shared or exclusive, several keys sorted
 * and taken once).
 */
import pg from 'pg';
import { advisoryLock, columns, fromPg, quoteSchema, SqlParams, toBool, toInt, toJson, toText, type SqlTransaction } from '../../lib/postgres/index.js';
import { endPool } from '../support/postgres.js';
import { onPostgres, testDatabase } from './support.js';

const { database, reason } = await testDatabase('sql');

describe('SqlParams', () => {
  it('casts each parameter from text, collects the values in order, and writes NULL-safe equality and IN lists', () => {
    const p = new SqlParams();
    expect([p.text('a'), p.int(7), p.bigint(1_790_000_000_000), p.bool(false), p.json({ a: 1 }), p.json(undefined), p.text(null), p.int(null)]).toEqual([
      '$1::text',
      '$2::text::integer',
      '$3::text::bigint',
      '$4::text::boolean',
      '$5::text::jsonb',
      '$6::text::jsonb',
      '$7::text',
      '$8::text::integer',
    ]);
    expect(p.values).toEqual(['a', '7', '1790000000000', 'false', '{"a":1}', null, null, null]);

    const q = new SqlParams();
    expect(q.equals('group_key', null)).toBe('group_key IS NULL');
    expect(q.equals('group_key', 'g1')).toBe('group_key = $1::text');
    expect(q.in('state', [])).toBe('FALSE');
    expect(q.in('state', ['waiting', 'active'])).toBe('state IN ($2::text, $3::text)');
    expect(q.values).toEqual(['g1', 'waiting', 'active']);
  });
});

describe('columns() and the readers', () => {
  it('cast each column to text under its own name, prefixed with the alias, and read the text back', () => {
    expect(columns(['id', 'run_at'])).toBe('id::text AS id, run_at::text AS run_at');
    expect(columns(['id', 'run_at'], 'j')).toBe('j.id::text AS id, j.run_at::text AS run_at');

    expect([toText('a'), toText(null), toText(undefined), toText(1)]).toEqual(['a', null, null, '1']);
    expect([toInt('1790000000000'), toInt('-5'), toInt(null), toInt(undefined)]).toEqual([1_790_000_000_000, -5, null, null]);
    expect([toBool('true'), toBool(true), toBool('false'), toBool(null)]).toEqual([true, true, false, false]);
    expect([toJson('{"a":[1]}'), toJson('"text"'), toJson(null), toJson(undefined)]).toEqual([{ a: [1] }, 'text', null, null]);
  });
});

describe('quoteSchema()', () => {
  it('quotes a schema name after checking it, and names the store in its refusal', () => {
    expect(quoteSchema('nest_outbox', 'PostgresOutboxStore')).toBe('"nest_outbox"');
    expect(quoteSchema('Mixed_Case1', 'PostgresOutboxStore')).toBe('"Mixed_Case1"');
    for (const schema of ['bad-name', '1st', '', 'x'.repeat(64), 'a"b', 'a$1', null, 42]) {
      expect(() => quoteSchema(schema, 'PostgresOutboxStore')).toThrow(
        `PostgresOutboxStore: invalid schema ${JSON.stringify(schema)}. Use letters, digits and underscores, not starting with a digit, at most 63 characters.`,
      );
    }
  });
});

describe('advisoryLock()', () => {
  onPostgres(reason);

  let pool: pg.Pool;
  beforeAll(() => {
    if (database) {
      pool = new pg.Pool({ connectionString: database.url, max: 4 });
    }
  });
  afterAll(async () => {
    if (pool) {
      await endPool(pool);
    }
  });

  /** Holds `keys` in a transaction of its own until `release()`; `acquired` resolves once it has them. */
  function holder(keys: string | string[], options?: { shared?: boolean }) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired = false;
    const done = fromPg(pool).transaction(async (tx) => {
      await advisoryLock(tx, keys, options);
      acquired = true;
      await released;
    });
    return { release, done, acquired: () => acquired };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  it('holds an exclusive lock until the transaction ends, and lets shared locks share while excluding an exclusive one', async () => {
    const first = holder('@nestjs/notes:s:exclusive');
    await settle();
    const second = holder('@nestjs/notes:s:exclusive');
    await settle();
    expect([first.acquired(), second.acquired()]).toEqual([true, false]);
    first.release();
    await first.done;
    await settle();
    expect(second.acquired()).toBe(true);
    second.release();
    await second.done;

    const readers = [holder('@nestjs/notes:s:shared', { shared: true }), holder('@nestjs/notes:s:shared', { shared: true })];
    await settle();
    const writer = holder('@nestjs/notes:s:shared');
    await settle();
    expect([...readers.map((reader) => reader.acquired()), writer.acquired()]).toEqual([true, true, false]);
    readers.forEach((reader) => reader.release());
    await Promise.all(readers.map((reader) => reader.done));
    await settle();
    expect(writer.acquired()).toBe(true);
    writer.release();
    await writer.done;
  });

  it('takes several keys one after another in sorted order, each once', async () => {
    const taken: unknown[] = [];
    const tx: SqlTransaction = {
      query: async (text, params) => {
        taken.push([text, ...(params ?? [])]);
        return [];
      },
    };
    await advisoryLock(tx, ['k:b', 'k:a', 'k:b', 'k:c']);
    await advisoryLock(tx, 'k:z', { shared: true });
    expect(taken).toEqual([
      ['SELECT pg_advisory_xact_lock(hashtext($1::text))::text AS locked', 'k:a'],
      ['SELECT pg_advisory_xact_lock(hashtext($1::text))::text AS locked', 'k:b'],
      ['SELECT pg_advisory_xact_lock(hashtext($1::text))::text AS locked', 'k:c'],
      ['SELECT pg_advisory_xact_lock_shared(hashtext($1::text))::text AS locked', 'k:z'],
    ]);
  });
});
