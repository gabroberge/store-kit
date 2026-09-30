/**
 * Which migrations `StoreSchema.statements()` returns: those that bring `schema` from version `from` to `to`.
 *
 * ```ts
 * outboxSchema.statements({ schema: 'shop_outbox', from: 1 }); // what a schema at version 1 still needs
 * ```
 */
export interface MigrationStatementsOptions {
  /** The PostgreSQL schema. Default: the store's (`defaultSchema`). */
  schema?: string;
  /** The version to start from: `0` (the default) is a new database. */
  from?: number;
  /** The version to end at. Default: the latest. */
  to?: number;
}

/**
 * What `StoreSchema.sql()` takes, and a store's `static migrationSql()` with it.
 *
 * ```ts
 * PostgresOutboxStore.migrationSql({ schema: 'shop_outbox', statementBreakpoints: true });
 * ```
 */
export interface MigrationSqlOptions extends MigrationStatementsOptions {
  /**
   * Put drizzle-kit's `--> statement-breakpoint` between the statements, for a custom drizzle-kit migration
   * (`drizzle-kit generate --custom`): its migrator runs them one at a time, which PGlite needs. Default: `false`.
   */
  statementBreakpoints?: boolean;
}
