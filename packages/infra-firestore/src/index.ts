/**
 * @intexuraos/infra-firestore
 *
 * Firestore client and adapters.
 * Depends on @intexuraos/common-core for Result types.
 */

// Firestore client
export {
  getFirestore,
  resetFirestore,
  setFirestore,
  FieldValue,
  Timestamp,
  type Firestore,
} from './firestore.js';

// Schema-version write helper
export { withSchemaVersion, type SchemaVersionedFields } from './schemaVersion.js';

// TTL helper for retention-driven deletion
export { computeExpireAt, RETENTION_24H_MS, RETENTION_7D_MS } from './expireAt.js';

// Testing utilities
export {
  createFakeFirestore,
  type FakeFirestore,
  type FakeFirestoreConfig,
} from './testing/index.js';

// Health check — only the factory is exported; the structurally-compatible
// `HealthCheck`/`HealthCheckOutcome` interfaces are defined locally so this
// package does not depend on `@intexuraos/http-server`. Callers should
// import the canonical types from `@intexuraos/http-server`.
export { firestoreHealthCheck } from './health.js';

// Generic CRUD repository factory
export {
  createFirestoreCrudRepository,
  type CrudRepository,
  type CrudRepositoryOptions,
} from './crudRepository.js';
