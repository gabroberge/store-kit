import { hasMethod } from '../../utils/executor.util.js';

/** mysql2's `CLIENT_FOUND_ROWS` capability flag. */
const FOUND_ROWS = 2;

/**
 * Throws a `TypeError` unless `text` has exactly as many `?` placeholders as `params` has values. MySQL's clients bind
 * every `?` in order, one in a literal or a comment included, and mysql2 reads `??` as an identifier placeholder: a
 * count that doesn't match means a value would land in the wrong place, so the statement never runs.
 */
export function checkPlaceholders(text: string, params: readonly unknown[]): void {
  if (text.includes('??')) {
    throw new TypeError("A MySQL statement can't hold ??: mysql2 reads it as an identifier placeholder. Write each ? on its own.");
  }

  let placeholders = 0;
  for (const character of text) {
    if (character === '?') {
      placeholders++;
    }
  }
  if (placeholders !== params.length) {
    throw new TypeError(
      `A MySQL statement's ? placeholders must match its params: this one has ${placeholders} placeholder${placeholders === 1 ? '' : 's'} and ${params.length} param${params.length === 1 ? '' : 's'} (a ? in a literal or a comment counts too).`,
    );
  }
}

/**
 * Throws a `TypeError` when `flags` (a mysql2 connection's capability flags) lack `CLIENT_FOUND_ROWS`, which mysql2
 * sets by default: without it, an UPDATE counts the rows it changed instead of those it matched, and a store's
 * `execute()` would read an update that wrote the same values as a miss. `undefined` (flags not found) passes.
 */
export function assertFoundRows(flags: unknown, what: string): void {
  if (typeof flags === 'number' && (flags & FOUND_ROWS) === 0) {
    throw new TypeError(
      `${what} needs mysql2's FOUND_ROWS client flag, which it sets by default: without it, an UPDATE counts the rows it changed instead of the rows it matched. ` +
        "Remove '-FOUND_ROWS' from the client's flags, or give the store a pool of its own.",
    );
  }
}

/** The capability flags of a mysql2 pool or connection, of the promise API or the callback one. */
export function mysql2Flags(client: unknown): unknown {
  const candidate = client as {
    pool?: { config?: { connectionConfig?: { clientFlags?: unknown } } };
    connection?: { config?: { clientFlags?: unknown } };
    config?: { clientFlags?: unknown; connectionConfig?: { clientFlags?: unknown } };
  };
  return (
    candidate?.pool?.config?.connectionConfig?.clientFlags ??
    candidate?.connection?.config?.clientFlags ??
    candidate?.config?.connectionConfig?.clientFlags ??
    candidate?.config?.clientFlags
  );
}

/** A node-postgres pool or client (or a pg-compatible one): what a MySQL executor names when it's given one. */
export function isPgClient(value: unknown): boolean {
  return hasMethod(value, 'escapeIdentifier') || (hasMethod(value, 'connect') && typeof (value as { totalCount?: unknown }).totalCount === 'number');
}
