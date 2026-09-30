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
 * An `integer` or `bigint` column read as text (`columns()`): a number, or `null` for SQL `NULL`. A `bigint` past
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
 * A `boolean` column read as text (`columns()`).
 *
 * ```ts
 * const paused = toBool(row.paused);
 * ```
 */
export function toBool(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * A `jsonb` column read as text (`columns()`): the value, or `null` for SQL `NULL`.
 *
 * ```ts
 * const payload = toJson(row.payload);
 * ```
 */
export function toJson(value: unknown): unknown {
  return value === null || value === undefined ? null : JSON.parse(String(value));
}
