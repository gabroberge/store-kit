import type { ResolvedStoreOptions, StoreOptions } from '../interfaces/store-options.interface.js';
import type { StoreSchemaOptions } from '../interfaces/store-schema-options.interface.js';
import { hasMethod } from '../utils/executor.util.js';
import { DIALECT_NAMES, type DialectInfo } from './dialect.js';

/**
 * A store's `executor`, `schema` and `migrate` options, checked (a `TypeError` that names the store) and defaulted:
 * the store's own schema, and `migrate` on except in production, where DDL at boot would surprise: a package
 * upgrade would change the schema during a rolling deploy, DDL takes locks on busy tables, and least-privilege
 * database users can't run it.
 */
export function resolveStoreOptions(
  store: Pick<StoreSchemaOptions, 'packageName' | 'storeName' | 'defaultSchema'>,
  dialect: DialectInfo,
  options: StoreOptions,
): ResolvedStoreOptions {
  const { packageName, storeName } = store;
  const executor = options?.executor;
  if (!hasMethod(executor, 'query') || !hasMethod(executor, 'transaction') || !hasMethod(executor, 'wrapTransaction')) {
    throw new TypeError(`${storeName}: \`executor\` must be a SqlExecutor, such as ${dialect.executors}.`);
  }

  // An executor is a plain object satisfying an interface, from whichever copy of the kit made it: its dialect is
  // what tells a PostgreSQL executor from a MySQL one.
  const executorDialect: unknown = executor.dialect;
  if (executorDialect !== dialect.dialect) {
    throw new TypeError(
      executorDialect === undefined
        ? `${storeName}: \`executor\` doesn't say which database it runs on: a SqlExecutor has a \`dialect\` ('${dialect.dialect}' for ${DIALECT_NAMES[dialect.dialect]}).`
        : `${storeName} runs on ${DIALECT_NAMES[dialect.dialect]}, and \`executor\` is a ${DIALECT_NAMES[executorDialect as keyof typeof DIALECT_NAMES] ?? String(executorDialect)} executor: ` +
            `import the executor from '${packageName}/${dialect.dialect}' (${dialect.executorNames}).`,
    );
  }

  if (options.migrate !== undefined && typeof options.migrate !== 'boolean') {
    throw new TypeError(`${storeName}: \`migrate\` must be true or false, not ${JSON.stringify(options.migrate)}.`);
  }

  const schema = options.schema ?? store.defaultSchema;
  dialect.checkSchema(schema, storeName);
  return { executor, schema, migrate: options.migrate ?? process.env.NODE_ENV !== 'production' };
}
