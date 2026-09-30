/**
 * The schema of a small store built on the kit, as a package defines it: its migrations, its error, and its
 * `StoreSchema`. The tests use it the way a package would, and build variants of it (other migrations) to check the
 * kit's behaviour at other versions.
 */
import { StoreSchema, type StoreMigration, type StoreSchemaErrorDetails, type StoreSchemaOptions } from '../../../lib/postgres/index.js';

/** The package's schema error, as `createError` makes it. */
export class NoteSchemaError extends Error {
  override name = 'NoteSchemaError';
  readonly schema: string;
  readonly version: number;
  readonly requiredVersion: number;

  constructor(message: string, details: StoreSchemaErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.schema = details.schema;
    this.version = details.version;
    this.requiredVersion = details.requiredVersion;
  }
}

export const initialMigration: StoreMigration = {
  version: 1,
  name: 'initial',
  up: (s) => [
    `CREATE TABLE ${s}.notes (
  id text PRIMARY KEY,
  body text NOT NULL,
  created_at bigint NOT NULL
)`,
    `CREATE TABLE ${s}.note_tags (
  note_id text NOT NULL REFERENCES ${s}.notes (id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (note_id, tag)
)`,
    `CREATE INDEX notes_created ON ${s}.notes (created_at, id)`,
    `CREATE INDEX note_tags_tag ON ${s}.note_tags (tag)`,
  ],
};

export const archiveMigration: StoreMigration = {
  version: 2,
  name: 'archive',
  up: (s) => [`ALTER TABLE ${s}.notes ADD COLUMN archived boolean NOT NULL DEFAULT false`, `CREATE INDEX notes_archived ON ${s}.notes (created_at) WHERE archived`],
};

export const noteSchemaOptions: StoreSchemaOptions = {
  packageName: '@nestjs/notes',
  storeName: 'PostgresNoteStore',
  command: 'nest-notes',
  defaultSchema: 'nest_notes',
  migrations: [initialMigration, archiveMigration],
  createError: (message, details) => new NoteSchemaError(message, details),
};

export const noteSchema = new StoreSchema(noteSchemaOptions);

/** The same store's schema with other migrations: an older or a newer version of the package. */
export const noteSchemaWith = (migrations: StoreMigration[]) => new StoreSchema({ ...noteSchemaOptions, migrations });
