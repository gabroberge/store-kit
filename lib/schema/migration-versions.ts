/** What the version arithmetic needs of a migration, whichever dialect's it is. */
export interface VersionedMigration {
  version: number;
  name: string;
}

/** The version a store needs: its last migration's. */
export function latestVersion(migrations: readonly VersionedMigration[]): number {
  return migrations.at(-1)?.version ?? 0;
}

/**
 * `range`'s versions, defaulted (from 0, a new database, to `latest`) and checked: a `RangeError` for versions no
 * migrations lead between, a downgrade included.
 */
export function migrationRange(storeName: string, latest: number, range: { from?: number; to?: number }): { from: number; to: number } {
  const from = range.from ?? 0;
  const to = range.to ?? latest;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > latest || from > to) {
    throw new RangeError(
      `${storeName}.migrationSql(): no migrations lead from version ${from} to ${to}. Versions go from 0 (none applied) to ${latest}, and never back: downgrades aren't supported.`,
    );
  }
  return { from, to };
}

/** The migrations that bring a schema at version `from` to version `to`, in order. */
export function migrationsBetween<M extends VersionedMigration>(migrations: readonly M[], from: number, to: number): M[] {
  return migrations.filter((migration) => migration.version > from && migration.version <= to);
}
