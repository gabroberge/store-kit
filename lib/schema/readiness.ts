import type { SqlTransaction } from '../interfaces/sql-executor.interface.js';
import type { StoreReadiness, StoreReadinessOptions } from '../interfaces/store-readiness.interface.js';
import { IN_TRANSACTION_HINT } from './schema-messages.js';

/** What a dialect's `StoreSchema` plugs into a store's readiness. */
export interface ReadinessSteps {
  /** The dialect's checks of the connection, before anything else (PostgreSQL: its default isolation). */
  check(db: SqlTransaction): Promise<void>;
  /** Fails with the package's schema error while the schema is behind the store. */
  assertMigrated(db: SqlTransaction, hint?: string): Promise<void>;
  /** Applies the pending migrations, resolving to the versions applied. */
  migrate(): Promise<number[]>;
}

/**
 * A store's readiness, the same on every dialect: checked once and remembered; a failed preparation forgotten, so the
 * next call tries again (a migration applied meanwhile is picked up without a restart); calls that arrive while it
 * prepares wait for the same preparation.
 */
export class Readiness implements StoreReadiness {
  private preparing?: Promise<void>;
  private prepared = false;

  constructor(
    private readonly storeName: string,
    private readonly options: StoreReadinessOptions,
    private readonly steps: ReadinessSteps,
  ) {}

  ready(): Promise<void> {
    if (this.prepared) {
      return Promise.resolve();
    }

    this.preparing ??= this.prepare().then(
      () => {
        this.prepared = true;
      },
      (error: unknown) => {
        this.preparing = undefined;
        throw error;
      },
    );
    return this.preparing;
  }

  async readyIn(transaction: SqlTransaction): Promise<void> {
    if (this.prepared) {
      return;
    }

    await this.steps.check(transaction);
    await this.steps.assertMigrated(transaction, IN_TRANSACTION_HINT);
    this.prepared = true;
  }

  async migrate(): Promise<number[]> {
    const applied = await this.steps.migrate();
    if (applied.length > 0) {
      this.options.logger?.log(`${this.storeName}: migrated schema "${this.options.schema}" to version ${applied.at(-1)}.`);
    }
    return applied;
  }

  private async prepare(): Promise<void> {
    await this.steps.check(this.options.executor);
    if (this.options.migrate) {
      await this.migrate();
    } else {
      await this.steps.assertMigrated(this.options.executor);
    }
  }
}
