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

// Generic CRUD repository factory
export {
  createFirestoreCrudRepository,
  type CrudRepository,
  type CrudRepositoryOptions,
} from './crudRepository.js';
