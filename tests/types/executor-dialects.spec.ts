/**
 * An executor of the other dialect is a compile error, both ways: a PostgreSQL store's options (`/postgres`'s
 * `StoreOptions` and `SqlExecutor`, PostgreSQL's) refuse a MySQL executor, and a MySQL store's (`/mysql`'s) a PostgreSQL
 * one. A value annotated with a subpath's `SqlExecutor` (`const executor: SqlExecutor = fromDrizzle(db)`) fits that
 * dialect's store; the root's `SqlExecutor` alone takes either. The `@ts-expect-error` lines are checked by the repo's
 * typecheck (`tsc -p tsconfig.json --noEmit`, which CI runs): each would be an unused directive if its line compiled.
 * The test runs the compiler on the same mismatches without the directives (tests/types/fixtures), and reads its errors:
 * the fixture's annotated executors, in their dialect's stores, give none.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlExecutor as AnySqlExecutor } from '../../lib/index.js';
import { fromMysql2, type SqlExecutor as MySqlExecutor, type StoreOptions as MySqlStoreOptions } from '../../lib/mysql/index.js';
import { fromPg, type SqlExecutor, type StoreOptions } from '../../lib/postgres/index.js';
import { MySqlNoteStore } from '../fixtures/notes/mysql-note.store.js';
import { PostgresNoteStore } from '../fixtures/notes/postgres-note.store.js';

/** Never called: what compiles in it, and what doesn't, is the test (the repo's typecheck runs it). */
export function typeChecks(postgres: SqlExecutor<'postgres'>, mysql: MySqlExecutor<'mysql'>): unknown[] {
  // Each dialect's executors where theirs go, and either where either goes.
  const either: AnySqlExecutor[] = [postgres, mysql, fromPg({} as never), fromMysql2({} as never)];
  const fits = [new PostgresNoteStore({ executor: fromPg({} as never) }), new MySqlNoteStore({ executor: fromMysql2({} as never) })];

  // @ts-expect-error A MySQL executor where a PostgreSQL one goes
  const toPostgres: SqlExecutor<'postgres'> = mysql;
  // @ts-expect-error A MySQL executor in a PostgreSQL store's options
  const postgresOptions: StoreOptions<'postgres'> = { executor: fromMysql2({} as never) };
  // @ts-expect-error A PostgreSQL executor where a MySQL one goes
  const toMysql: MySqlExecutor = postgres;
  // @ts-expect-error A PostgreSQL executor in a MySQL store's options
  const mysqlOptions: MySqlStoreOptions = { executor: fromPg({} as never) };

  // A subpath's SqlExecutor, as a user annotates one, is that dialect's: its store takes it, the other's doesn't.
  const annotatedPostgres: SqlExecutor = fromPg({} as never);
  const annotatedMysql: MySqlExecutor = fromMysql2({} as never);
  const annotatedFit = [new PostgresNoteStore({ executor: annotatedPostgres }), new MySqlNoteStore({ executor: annotatedMysql })];
  // @ts-expect-error A MySQL executor, annotated with /mysql's SqlExecutor, in a PostgreSQL store's options
  const crossed = new PostgresNoteStore({ executor: annotatedMysql });
  // @ts-expect-error A PostgreSQL executor, annotated with /postgres's SqlExecutor, in a MySQL store's options
  const crossedBack = new MySqlNoteStore({ executor: annotatedPostgres });
  return [either, fits, toPostgres, postgresOptions, toMysql, mysqlOptions, annotatedFit, crossed, crossedBack];
}

describe("an executor of the other dialect in a store's options", () => {
  it('is a compile error both ways, with an error that names both dialects', () => {
    // TypeScript's own compiler (its package exports its package.json, not its bin), from the repo's root.
    const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc');
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const { stdout, status } = spawnSync(process.execPath, [tsc, '-p', 'tests/types/fixtures/tsconfig.json', '--noEmit', '--pretty', 'false'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(status).not.toBe(0);
    const errors = stdout.split('\n').filter((line) => line.includes('error TS'));
    const mysqlForPostgres = "error TS2322: Type 'SqlExecutor<\"mysql\">' is not assignable to type 'SqlExecutor<\"postgres\">'.";
    const postgresForMysql = "error TS2322: Type 'SqlExecutor<\"postgres\">' is not assignable to type 'SqlExecutor<\"mysql\">'.";
    // The lines of `mismatches()`: a MySQL executor, then fromMysql2(), for PostgresNoteStore; the reverse for MySqlNoteStore.
    expect(errors).toEqual([
      `tests/types/fixtures/dialect-mismatch.ts(11,29): ${mysqlForPostgres}`,
      `tests/types/fixtures/dialect-mismatch.ts(12,29): ${mysqlForPostgres}`,
      `tests/types/fixtures/dialect-mismatch.ts(13,26): ${postgresForMysql}`,
      `tests/types/fixtures/dialect-mismatch.ts(14,26): ${postgresForMysql}`,
    ]);
    expect(stdout).toContain(`Type '"mysql"' is not assignable to type '"postgres"'.`);
    expect(stdout).toContain(`Type '"postgres"' is not assignable to type '"mysql"'.`);
  });
});
