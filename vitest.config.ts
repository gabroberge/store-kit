import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Legacy decorators with emitted metadata, as TypeORM's entities in the tests need them. Class fields declared
  // without an initializer are types only, as under `tsc` with `useDefineForClassFields: false`.
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
    assumptions: { setPublicClassFields: true },
    typescript: { removeClassFieldsWithoutInitializer: true },
  },
  test: {
    globals: true,
    setupFiles: ['reflect-metadata'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'postgres',
          include: ['tests/**/*.spec.ts'],
          exclude: ['tests/mysql/**'],
          // The Prisma client the tests use is generated first; PostgreSQL comes from SQL_TEST_PG_URL (its stale
          // `skit_` test databases swept before and after the run), else a throwaway cluster from local binaries,
          // else the tests that need it are skipped with the reason. PGlite runs everywhere.
          globalSetup: ['tests/support/generate-prisma-client.ts', 'tests/support/global-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'mysql',
          include: ['tests/mysql/**/*.spec.ts'],
          // MySQL comes from SQL_TEST_MYSQL_URL (its stale `skit_` databases swept before and after the run), else
          // the tests are skipped with the reason. The server may be shared: two files at a time, after the
          // PostgreSQL files, keep its connections well under max_connections (151 by default).
          globalSetup: ['tests/support/generate-prisma-mysql-client.ts', 'tests/support/mysql-global-setup.ts'],
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
