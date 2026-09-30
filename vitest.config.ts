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
    // The Prisma client the tests use is generated first; PostgreSQL comes from SQL_TEST_PG_URL (its stale `skit_`
    // test databases swept before and after the run), else a throwaway cluster from local binaries, else the tests
    // that need it are skipped with the reason. PGlite runs everywhere.
    globalSetup: ['tests/support/generate-prisma-client.ts', 'tests/support/global-setup.ts'],
    include: ['tests/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
