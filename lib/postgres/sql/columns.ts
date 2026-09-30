/**
 * A select list of `names`, each cast to text under its own name (`id::text AS id, ...`), prefixed with `alias` when
 * given: read the values with `toText()`, `toInt()`, `toBool()` and `toJson()` (see `SqlParams`). An ORDER BY of the
 * statement names its columns with their table (`j.created_at`): a bare name would sort the text (`'100' < '4'`).
 *
 * ```ts
 * const JOB_COLUMNS = ['id', 'attempts', 'data', 'run_at'];
 * const rows = await executor.query<Row>(`SELECT ${columns(JOB_COLUMNS, 'j')} FROM ${t.jobs} j ORDER BY j.run_at, j.id`);
 * const jobs = rows.map((row) => ({ id: row.id!, attempts: toInt(row.attempts)!, data: toJson(row.data), runAt: toInt(row.run_at)! }));
 * ```
 */
export function columns(names: readonly string[], alias?: string): string {
  return names.map((name) => `${alias ? `${alias}.` : ''}${name}::text AS ${name}`).join(', ');
}

// The readers of a column's text are the same on every dialect.
export { toBool, toInt, toJson, toText } from '../../sql/converters.js';
