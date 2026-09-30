/**
 * A statement's parameters, as a MySQL store writes them: every value goes to the client as a string (or `null`) for a
 * `?` placeholder, cast in the statement where it isn't text (`CAST(? AS SIGNED)`), and every column comes back cast
 * to text (`columns()`), read with `toText()`, `toInt()`, `toBool()` and `toJson()`. mysql2, the ORMs and Prisma's
 * adapter parse and send values in their own ways (a BIGINT is a `number` that loses precision to one, a `BigInt` to
 * another; a JSON column an object to one, a string to another), and text passes through all of them as it is.
 *
 * ```ts
 * const p = new SqlParams();
 * const { affectedRows } = await executor.execute(
 *   `UPDATE ${t.jobs} SET lease_owner = ${p.text(owner)}, lease_until = ${p.bigint(until)}
 * WHERE id = ${p.text(id)} AND ${p.equals('group_key', groupKey)} AND ${p.in('state', ['waiting', 'active'])}`,
 *   p.values,
 * );
 * ```
 *
 * Text goes bare (`?`): compared with a key column, the column's binary collation decides, not the connection's. Write
 * no `?` in a statement but its placeholders (none in a literal or a comment), and no `??`: the executors count them.
 */
export class SqlParams {
  /** What the statement's placeholders take, in order: pass it as the statement's `params`. */
  readonly values: Array<string | null> = [];

  /** `?`: text, compared by the column's collation. */
  text(value: string | null): string {
    this.values.push(value);
    return '?';
  }

  /** `CAST(? AS SIGNED)`, for an INT column. Throws a `TypeError` for anything but a whole number or `null`. */
  int(value: number | null): string {
    return this.add(wholeNumber(value, 'int'), 'CAST(? AS SIGNED)');
  }

  /** `CAST(? AS SIGNED)`, for a BIGINT column: epoch milliseconds, and any integer past INT's range. */
  bigint(value: number | null): string {
    return this.add(wholeNumber(value, 'bigint'), 'CAST(? AS SIGNED)');
  }

  /** `CAST(? AS UNSIGNED)` of `1` or `0`, for a BOOLEAN (TINYINT(1)) column. */
  bool(value: boolean): string {
    return this.add(value ? '1' : '0', 'CAST(? AS UNSIGNED)');
  }

  /** `CAST(? AS JSON)`, for a JSON column; `null` and `undefined` as SQL `NULL`. */
  json(value: unknown): string {
    return this.add(value === null || value === undefined ? null : JSON.stringify(value), 'CAST(? AS JSON)');
  }

  /** `column = ?`, or `column IS NULL` for `null`: keys match exactly, and `NULL = NULL` isn't true. */
  equals(column: string, value: string | null): string {
    return value === null ? `${column} IS NULL` : `${column} = ${this.text(value)}`;
  }

  /** `column IN (?, ...)` of the given values; `FALSE` for none. */
  in(column: string, values: readonly string[]): string {
    return values.length === 0 ? 'FALSE' : `${column} IN (${values.map((value) => this.text(value)).join(', ')})`;
  }

  /**
   * A LIMIT or OFFSET count, written into the statement: MySQL takes no expression there, and a client that binds `?`
   * on its side would send `LIMIT '10'`, a syntax error. Throws a `TypeError` for anything but a whole number from 0.
   */
  limit(value: number): string {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`SqlParams.limit() takes a whole number from 0, not ${JSON.stringify(value)}.`);
    }
    return String(value);
  }

  private add(value: string | null, placeholder: string): string {
    this.values.push(value);
    return placeholder;
  }
}

/** `value` as text, after checking it's a whole number: MySQL would round `1.5` or wrap `2^63` without an error. */
function wholeNumber(value: number | null, method: string): string | null {
  if (value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`SqlParams.${method}() takes a whole number (or null), not ${String(value)}: MySQL would round it, or wrap it past 2^63, without an error.`);
  }
  return String(value);
}
