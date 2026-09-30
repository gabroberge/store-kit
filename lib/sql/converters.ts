/**
 * A text column as a store reads it (the dialect's `columns()` casts every column to text): `null` for SQL `NULL`.
 * The same on PostgreSQL and MySQL, so a package's row mapping serves both of its stores.
 *
 * ```ts
 * const leaseOwner = toText(row.lease_owner);
 * ```
 */
export function toText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * An integer column read as text (PostgreSQL's `integer` and `bigint`, MySQL's INT and BIGINT): a number, or `null`
 * for SQL `NULL`. A value past `Number.MAX_SAFE_INTEGER` loses precision: keep such values (ids, counters) as text.
 *
 * ```ts
 * const runAt = toInt(row.run_at);
 * ```
 */
export function toInt(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * A boolean column read as text: PostgreSQL's `boolean` reads `'true'`, MySQL's BOOLEAN (TINYINT(1)) `'1'`; `'false'`,
 * `'0'` and SQL `NULL` are false.
 *
 * ```ts
 * const paused = toBool(row.paused);
 * ```
 */
export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

/**
 * A JSON column read as text (PostgreSQL's `jsonb`, MySQL's JSON): the value, or `null` for SQL `NULL`. Both store
 * JSON normalized (an object's keys reordered, duplicates dropped), so the value round-trips, not its text.
 *
 * ```ts
 * const payload = toJson(row.payload);
 * ```
 */
export function toJson(value: unknown): unknown {
  return value === null || value === undefined ? null : JSON.parse(String(value));
}
