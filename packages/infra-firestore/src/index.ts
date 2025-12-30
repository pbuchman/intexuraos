/**
 * @intexuraos/infra-firestore
 *
 * Firestore client and adapters.
 * Depends on @intexuraos/common-core for Result types.
 */

// Firestore client
export { getFirestore, resetFirestore, setFirestore, FieldValue } from './firestore.js';

// Testing utilities
export {
  createFakeFirestore,
  type FakeFirestore,
  type FakeFirestoreConfig,
} from './testing/index.js';
