import { quoteIdentifier } from './identifiers.js';

/**
 * A select list of `names`, each cast to text under its own name (`` CAST(`id` AS CHAR) AS `id`, ... ``), prefixed with
 * `alias` when given: read the values with `toText()`, `toInt()`, `toBool()` and `toJson()` (see `SqlParams`). An
 * ORDER BY of the statement names its columns with their table (`j.created_at`): a bare name would sort the text
 * (`'100' < '4'`).
 *
 * ```ts
 * const JOB_COLUMNS = ['id', 'attempts', 'data', 'run_at'];
 * const rows = await executor.query<Row>(`SELECT ${columns(JOB_COLUMNS, 'j')} FROM ${t.jobs} j ORDER BY j.run_at, j.id`);
 * const jobs = rows.map((row) => ({ id: row.id!, attempts: toInt(row.attempts)!, data: toJson(row.data), runAt: toInt(row.run_at)! }));
 * ```
 */
export function columns(names: readonly string[], alias?: string): string {
  const prefix = alias === undefined ? '' : `${quoteIdentifier(alias)}.`;
  return names.map((name) => `CAST(${prefix}${quoteIdentifier(name)} AS CHAR) AS ${quoteIdentifier(name)}`).join(', ');
}

/**
 * A text column as a store reads it (`columns()`): `null` for SQL `NULL`.
 *
 * ```ts
 * const leaseOwner = toText(row.lease_owner);
 * ```
 */
export function toText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * An INT or BIGINT column read as text (`columns()`): a number, or `null` for SQL `NULL`. A BIGINT past
 * `Number.MAX_SAFE_INTEGER` loses precision: keep such values (ids, counters) as text.
 *
 * ```ts
 * const runAt = toInt(row.run_at);
 * ```
 */
export function toInt(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * A BOOLEAN (TINYINT(1)) column read as text (`columns()`): `'1'` is true (`SqlParams.bool()` writes 1 and 0), `'0'`
 * and SQL `NULL` false.
 *
 * ```ts
 * const paused = toBool(row.paused);
 * ```
 */
export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/**
 * A JSON column read as text (`columns()`): the value, or `null` for SQL `NULL`. MySQL stores JSON normalized (an
 * object's keys sorted, duplicates dropped), so the value round-trips, not its text.
 *
 * ```ts
 * const payload = toJson(row.payload);
 * ```
 */
export function toJson(value: unknown): unknown {
  return value === null || value === undefined ? null : JSON.parse(String(value));
}
