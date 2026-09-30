import type { StoreSchemaOptions } from '../interfaces/store-schema-options.interface.js';
import type { DialectInfo } from './dialect.js';

/** A migration's name: it goes into the `migrations` table as a literal. */
const MIGRATION_NAME = /^[A-Za-z0-9_]+$/;

/**
 * Throws a `TypeError` for a `StoreSchema` its store's author got wrong, when the store's module loads: names that
 * messages would print as `undefined`, a default schema the store would refuse, and migrations that aren't versions
 * 1, 2, 3... in order, each with a name and statements.
 */
export function checkSchemaOptions(options: StoreSchemaOptions, dialect: DialectInfo): void {
  for (const key of ['packageName', 'storeName', 'command'] as const) {
    const value = options?.[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`StoreSchema: \`${key}\` must be a non-empty string, not ${JSON.stringify(value)}.`);
    }
  }

  const owner = `${options.storeName}'s StoreSchema`;
  dialect.checkSchema(options.defaultSchema, owner);
  if (typeof options.createError !== 'function') {
    throw new TypeError(`${owner}: \`createError\` must be a function that returns the package's schema error.`);
  }
  if (!Array.isArray(options.migrations) || options.migrations.length === 0) {
    throw new TypeError(`${owner}: \`migrations\` must list the schema's versions, version 1 first.`);
  }

  options.migrations.forEach((migration, index) => {
    if (migration?.version !== index + 1) {
      throw new TypeError(
        `${owner}: the migrations must be versions 1, 2, 3... in order; the one at index ${index} is version ${JSON.stringify(migration?.version)}.`,
      );
    }
    if (typeof migration.name !== 'string' || !MIGRATION_NAME.test(migration.name)) {
      throw new TypeError(`${owner}: migration ${migration.version} is named ${JSON.stringify(migration.name)}. Use letters, digits and underscores.`);
    }
    if (typeof migration.up !== 'function') {
      throw new TypeError(`${owner}: migration ${migration.version} (${migration.name}) has no up() function.`);
    }
  });
}
