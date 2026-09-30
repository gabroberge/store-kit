// What every dialect's StoreSchema shares: the dialect's description, the definition's checks, version arithmetic, the
// script format, messages, a store's options and its readiness. Internal: each dialect's entry exports its own
// StoreSchema, built on these.
export * from './dialect.js';
export * from './migration-script.js';
export * from './migration-versions.js';
export * from './readiness.js';
export * from './schema-messages.js';
export * from './schema-options.js';
export * from './store-options.js';
