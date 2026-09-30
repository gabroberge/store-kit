/**
 * A statement's parameters, as a store writes them: every value goes to the driver as a string (or `null`), cast in
 * the statement (`$3::text::bigint`), and every column comes back cast to text (`columns()`), read with `toText()`,
 * `toInt()`, `toBool()` and `toJson()`. node-postgres, PGlite, Prisma and the rest parse and serialize values in their
 * own ways (a `bigint` is a string to one and a `BigInt` to another, a JSON string param is JSON to one and text to
 * another), and text is the one type they all pass through as it is: so an executor only passes statements through,
 * and an application's own type parsers change nothing.
 *
 * ```ts
 * const p = new SqlParams();
 * const [job] = await executor.query<Row>(
 *   `UPDATE ${t.jobs} SET lease_owner = ${p.text(owner)}, lease_until = ${p.bigint(until)}
 * WHERE id = ${p.text(id)} AND ${p.equals('group_key', groupKey)} AND ${p.in('state', ['waiting', 'active'])}
 * RETURNING ${columns(['id', 'attempts', 'data'])}`,
 *   p.values,
 * );
 * ```
 */
export class SqlParams {
  /** What the statement's placeholders take, in order: pass it as the statement's `params`. */
  readonly values: Array<string | null> = [];

  /** `$n::text`. */
  text(value: string | null): string {
    return this.add(value, 'text');
  }

  /** `$n::text::integer`. Throws a `TypeError` for anything but a whole number or `null`. */
  int(value: number | null): string {
    return this.add(wholeNumber(value, 'int'), 'integer');
  }

  /** `$n::text::bigint`: epoch milliseconds, and any integer past `integer`'s range. Whole numbers only, as `int()`. */
  bigint(value: number | null): string {
    return this.add(wholeNumber(value, 'bigint'), 'bigint');
  }

  /** `$n::text::boolean`. */
  bool(value: boolean): string {
    return this.add(String(value), 'boolean');
  }

  /** JSON, stored as `jsonb`; `null` and `undefined` as SQL `NULL`. */
  json(value: unknown): string {
    return this.add(value === null || value === undefined ? null : JSON.stringify(value), 'jsonb');
  }

  /** `column = value`, or `column IS NULL` for `null`: keys match exactly, and `NULL = NULL` isn't true. */
  equals(column: string, value: string | null): string {
    return value === null ? `${column} IS NULL` : `${column} = ${this.text(value)}`;
  }

  /** `column IN (...)` of the given values; `FALSE` for none. */
  in(column: string, values: readonly string[]): string {
    return values.length === 0 ? 'FALSE' : `${column} IN (${values.map((value) => this.text(value)).join(', ')})`;
  }

  private add(value: string | null, type: string): string {
    this.values.push(value);
    return type === 'text' ? `$${this.values.length}::text` : `$${this.values.length}::text::${type}`;
  }
}

/**
 * `value` as text, after checking it's a whole number: a fraction or `NaN` would fail the statement's cast with an
 * obscure error, and a number past `Number.MAX_SAFE_INTEGER` isn't the integer it looks like.
 */
function wholeNumber(value: number | null, method: string): string | null {
  if (value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`SqlParams.${method}() takes a whole number (or null), not ${String(value)}.`);
  }
  return String(value);
}
