import type { SqlExecutor } from '../interfaces/sql-executor.interface.js';
import type { SqlDialect } from '../schema/dialect.js';

/** How the command line reaches a database of one dialect for `migrate` and `status`. */
export interface CliDialect {
  /** The package the application installs to reach it, loaded on use: `pg`. */
  readonly driver: string;
  /** A connection on `url` for one command; `null` without `driver`. */
  open(url: string): Promise<{ executor: SqlExecutor; close(): Promise<void> } | null>;
}

/** The dialects of the URL schemes the command line knows, the ones it doesn't support yet included. */
export const URL_SCHEMES: Readonly<Record<string, SqlDialect>> = {
  'postgres:': 'postgres',
  'postgresql:': 'postgres',
  'mysql:': 'mysql',
};

/** The dialects the kit supports, each loaded when a command needs it. */
export const CLI_DIALECTS: Readonly<Partial<Record<SqlDialect, CliDialect>>> = {
  postgres: {
    driver: 'pg',
    open: async (url) => (await import('../postgres/schema/cli-connection.js')).openPostgres(url),
  },
};
