// Doesn't compile, on purpose: tests/types/executor-dialects.spec.ts compiles it and expects an error on each line of
// `mismatches()`, one per direction and kind, and none in `annotated()`. The repo's own typecheck leaves it out
// (tsconfig.json's `exclude`).
import { fromMysql2, type SqlExecutor as MySqlExecutor } from '../../../lib/mysql/index.js';
import { fromPg, type SqlExecutor } from '../../../lib/postgres/index.js';
import { MySqlNoteStore } from '../../fixtures/notes/mysql-note.store.js';
import { PostgresNoteStore } from '../../fixtures/notes/postgres-note.store.js';

export function mismatches(postgres: SqlExecutor<'postgres'>, mysql: MySqlExecutor): unknown[] {
  return [
    new PostgresNoteStore({ executor: mysql }),
    new PostgresNoteStore({ executor: fromMysql2({} as never) }),
    new MySqlNoteStore({ executor: postgres }),
    new MySqlNoteStore({ executor: fromPg({} as never) }),
  ];
}

/** A subpath's `SqlExecutor`, as a user annotates one: that dialect's store takes it. */
export function annotated(): unknown[] {
  const postgres: SqlExecutor = fromPg({} as never);
  const mysql: MySqlExecutor = fromMysql2({} as never);
  return [new PostgresNoteStore({ executor: postgres }), new MySqlNoteStore({ executor: mysql })];
}
