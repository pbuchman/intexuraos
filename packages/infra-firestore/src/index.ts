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
