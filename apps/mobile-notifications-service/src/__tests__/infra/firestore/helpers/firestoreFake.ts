import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore, resetFirestore, setFirestore, type FakeFirestore } from '@intexuraos/infra-firestore';

/**
 * Shared Firestore fake helper for infra tests.
 * Use `useFirestoreFake()` in beforeEach and `resetFirestoreFake()` in afterEach.
 * `useFirestoreFake()` returns the fake instance for error-path configuration.
 */
export function useFirestoreFake(): FakeFirestore {
  const fake = createFakeFirestore();
  setFirestore(fake as unknown as Firestore);
  return fake;
}

export function resetFirestoreFake(): void {
  resetFirestore();
}
