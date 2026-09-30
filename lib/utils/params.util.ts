/**
 * What an IN list of `SqlParams.in()` holds, checked: `'text'` for strings, `'number'` for whole numbers. One kind a
 * list (a column is compared with values of its type), and numbers whole and safe: a fraction would fail the
 * statement's cast on PostgreSQL, and MySQL would round it without an error.
 */
export function inListKind(values: readonly unknown[]): 'text' | 'number' {
  const kind = typeof values[0] === 'number' ? 'number' : 'text';
  for (const value of values) {
    if ((typeof value === 'number') !== (kind === 'number')) {
      throw new TypeError('SqlParams.in() takes strings or numbers, not both: a column is compared with values of its own type.');
    }
    if (kind === 'number' && !Number.isSafeInteger(value)) {
      throw new TypeError(`SqlParams.in() takes whole numbers (or strings), not ${String(value)}.`);
    }
  }
  return kind;
}
