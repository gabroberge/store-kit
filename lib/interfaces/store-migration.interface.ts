/**
 * One version of a store's schema. Migrations only ever add (tables, nullable or defaulted columns, indexes): in a
 * rolling deploy, the processes of the previous version keep running on the migrated schema. Downgrades aren't
 * supported: a schema never goes back to an earlier version.
 *
 * ```ts
 * const initial: StoreMigration = {
 *   version: 1,
 *   name: 'initial',
 *   up: (s) => [
 *     `CREATE TABLE ${s}.messages (id text PRIMARY KEY, payload jsonb NOT NULL, created_at bigint NOT NULL)`,
 *     `CREATE INDEX messages_created ON ${s}.messages (created_at, id)`,
 *   ],
 * };
 * ```
 */
export interface StoreMigration {
  /** 1, 2, 3...: the schema's version once it's applied. */
  version: number;
  /** Recorded with the version: letters, digits and underscores (`initial`, `delivery_attempts`). */
  name: string;
  /**
   * Its statements, for the schema (`s`, quoted: `"nest_outbox"`). Each runs on its own, in the migration's
   * transaction; none may be a transaction statement (`BEGIN`, `COMMIT`) or need to run outside one
   * (`CREATE INDEX CONCURRENTLY`).
   */
  up(s: string): string[];
}
