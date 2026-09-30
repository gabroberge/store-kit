/**
 * The helpers a store writes its statements with: SqlParams' casts and values, columns() and the readers of its text,
 * quoteSchema(), and advisoryLock()'s locks (held until the transaction ends, shared or exclusive, several keys sorted
 * and taken once).
 */
import pg from 'pg';
import { advisoryLock, columns, fromPg, quoteSchema, SqlParams, toBool, toInt, toJson, toText, type SqlTransaction } from '../../lib/postgres/index.js';
import { endPool } from '../support/postgres.js';
import { onPostgres, openPglite, testDatabase } from './support.js';

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

    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => new SqlParams().int(value)).toThrow(`SqlParams.int() takes a whole number (or null), not ${String(value)}.`);
      expect(() => new SqlParams().bigint(value)).toThrow(`SqlParams.bigint() takes a whole number (or null), not ${String(value)}.`);
    }
    expect(() => new SqlParams().int('7' as never)).toThrow(TypeError);

    const q = new SqlParams();
    expect(q.equals('group_key', null)).toBe('group_key IS NULL');
    expect(q.equals('group_key', 'g1')).toBe('group_key = $1::text');
    expect(q.in('state', [])).toBe('FALSE');
    expect(q.in('state', ['waiting', 'active'])).toBe('state IN ($2::text, $3::text)');
    expect(q.values).toEqual(['g1', 'waiting', 'active']);
  });

  it('writes an IN list of whole numbers as bigints (one kind a list), which finds the rows of integer and bigint columns', async () => {
    const p = new SqlParams();
    expect(p.in('m.seq', [3, 1_790_000_000_000, -2])).toBe('m.seq IN ($1::text::bigint, $2::text::bigint, $3::text::bigint)');
    expect(p.in('m.seq', [] as number[])).toBe('FALSE');
    expect(p.values).toEqual(['3', '1790000000000', '-2']);
    expect(() => new SqlParams().in('seq', [1, 'a'] as never)).toThrow('SqlParams.in() takes strings or numbers, not both: a column is compared with values of its own type.');
    expect(() => new SqlParams().in('id', ['a', 1] as never)).toThrow('SqlParams.in() takes strings or numbers, not both');
    for (const value of [1.5, Number.NaN, 2 ** 53]) {
      expect(() => new SqlParams().in('seq', [1, value])).toThrow(`SqlParams.in() takes whole numbers (or strings), not ${String(value)}.`);
    }

    const pglite = await openPglite();
    try {
      const r = new SqlParams();
      const rows = await pglite.executor.query(
        `SELECT ${columns(['n', 'big'], 't')} FROM (VALUES (1::integer, 1790000000000::bigint), (2, 2), (3, 3)) AS t(n, big)
WHERE ${r.in('t.n', [1, 3, 4])} AND ${r.in('t.big', [1_790_000_000_000, 3])} ORDER BY t.n`,
        r.values,
      );
      expect(rows).toEqual([
        { n: '1', big: '1790000000000' },
        { n: '3', big: '3' },
      ]);
    } finally {
      await pglite.close();
    }
  });
});

describe('columns() and the readers', () => {
  it('are the readers the root entry exports, the same on both dialects: a package maps the rows of both of its stores with them', async () => {
    const root = await import('../../lib/index.js');
    const mysql = await import('../../lib/mysql/index.js');
    expect([root.toText, root.toInt, root.toBool, root.toJson]).toEqual([toText, toInt, toBool, toJson]);
    expect([mysql.toText, mysql.toInt, mysql.toBool, mysql.toJson]).toEqual([toText, toInt, toBool, toJson]);
    // PostgreSQL's boolean reads 'true', MySQL's BOOLEAN '1'.
    expect([toBool('true'), toBool('1'), toBool(1), toBool('false'), toBool('0'), toBool(0)]).toEqual([true, true, true, false, false, false]);
  });

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

  it('takes one key as it always did, and several in one statement, ordered and deduplicated by their lock numbers', async () => {
    const taken: unknown[] = [];
    const tx: SqlTransaction = {
      query: async (text, params) => {
        taken.push([text, ...(params ?? [])]);
        return [];
      },
    };
    await advisoryLock(tx, 'k:z', { shared: true });
    await advisoryLock(tx, ['k:b', 'k:a', 'k:b', 'k:c']);
    await advisoryLock(tx, ['k:only', 'k:only']);
    await advisoryLock(tx, []);
    await advisoryLock(tx, 'k:y', { namespace: 'ns' });
    await advisoryLock(tx, ['k:b', 'k:a'], { namespace: 'ns', shared: true });
    expect(taken).toEqual([
      ['SELECT pg_advisory_xact_lock_shared(hashtext($1::text))::text AS locked', 'k:z'],
      [
        'SELECT pg_advisory_xact_lock(k.h)::text AS locked\nFROM (SELECT DISTINCT hashtext(t.key) AS h FROM jsonb_array_elements_text($1::text::jsonb) AS t(key)) AS k\nORDER BY k.h',
        '["k:b","k:a","k:c"]',
      ],
      ['SELECT pg_advisory_xact_lock(hashtext($1::text))::text AS locked', 'k:only'],
      ['SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))::text AS locked', 'ns', 'k:y'],
      [
        'SELECT pg_advisory_xact_lock_shared(hashtext($2::text), k.h)::text AS locked\nFROM (SELECT DISTINCT hashtext(t.key) AS h FROM jsonb_array_elements_text($1::text::jsonb) AS t(key)) AS k\nORDER BY k.h',
        '["k:b","k:a"]',
        'ns',
      ],
    ]);
    await expect(advisoryLock(tx, 'k', { namespace: 42 as never })).rejects.toThrow('advisoryLock() takes a string namespace, not 42.');
  });

  it("can't deadlock through keys whose hashes collide, where taking them one by one in their text's order did", async () => {
    // Keys whose hashtext() collide: two texts, one lock. Taken in the texts' order, two transactions can take the
    // same two locks in opposite orders.
    const { rows: pairs } = await pool.query<{ keys: string[] }>(
      "SELECT array_agg(k ORDER BY k) AS keys FROM (SELECT 'key:' || g AS k FROM generate_series(1, 300000) g) s GROUP BY hashtext(k) HAVING count(*) = 2",
    );
    const opposite = findOpposite(pairs.map((pair) => pair.keys as [string, string]));
    expect(opposite).toBeDefined();
    const [first, second] = opposite!;

    // The old way, one statement per key in the texts' order, with both transactions past their first lock: a deadlock.
    const byText = async (tx: SqlTransaction, keys: string[], between: () => Promise<void>) => {
      const [one, two] = [...new Set(keys)].sort();
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1::text))::text AS locked', [one]);
      await between();
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1::text))::text AS locked', [two]);
    };
    const bothFirst = barrier(2);
    const outcomes = await Promise.allSettled([
      fromPg(pool).transaction((tx) => byText(tx, first, bothFirst)),
      fromPg(pool).transaction((tx) => byText(tx, second, bothFirst)),
    ]);
    expect(outcomes.map((outcome) => (outcome.status === 'rejected' ? (outcome.reason as Error).message : 'done')).sort()).toEqual(['deadlock detected', 'done']);

    // advisoryLock() orders them by their lock numbers: many transactions at once, in opposite argument orders.
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        fromPg(pool).transaction(async (tx) => {
          await advisoryLock(tx, i % 2 === 0 ? first : [...second].reverse());
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        }),
      ),
    );
  });

  it("takes a namespace's locks in PostgreSQL's two-key space, apart from the one-key form's and other namespaces'", async () => {
    const outer = await pool.connect();
    try {
      await outer.query('BEGIN');
      await advisoryLock(fromPg(pool).wrapTransaction(outer), ['k:1', 'k:2'], { namespace: 'orders' });
      const tryLock = async (sql: string, params: string[]) =>
        fromPg(pool).transaction(async (tx) => (await tx.query<{ got: string }>(sql, params))[0]!.got);
      expect(await tryLock('SELECT pg_try_advisory_xact_lock(hashtext($1::text), hashtext($2::text))::text AS got', ['orders', 'k:1'])).toBe('false');
      expect(await tryLock('SELECT pg_try_advisory_xact_lock(hashtext($1::text), hashtext($2::text))::text AS got', ['payments', 'k:1'])).toBe('true');
      expect(await tryLock('SELECT pg_try_advisory_xact_lock(hashtext($1::text))::text AS got', ['k:1'])).toBe('true');
      await outer.query('COMMIT');
    } finally {
      outer.release();
    }
  });
});

/** Two transactions' keys, one of each colliding pair each, whose texts' order takes the two locks in opposite orders. */
function findOpposite(pairs: Array<[string, string]>): [string[], string[]] | undefined {
  for (const [i, left] of pairs.entries()) {
    for (const right of pairs.slice(i + 1)) {
      for (const [x, z] of [left, [...left].reverse()]) {
        for (const [y, w] of [right, [...right].reverse()]) {
          // The first of each by text: x's lock (left's) or y's (right's), and z's or w's.
          if (x! < y! !== z! < w!) {
            return [
              [x!, y!],
              [z!, w!],
            ];
          }
        }
      }
    }
  }
  return undefined;
}

/** Resolves for everyone once `count` have called it. */
function barrier(count: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return () => {
    if (++arrived === count) {
      open();
    }
    return opened;
  };
}
