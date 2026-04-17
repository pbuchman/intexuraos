import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';

/**
 * Shared Firestore fake helper for infra tests.
 * Use `useFirestoreFake()` in beforeEach and `resetFirestoreFake()` in afterEach.
 */
export function useFirestoreFake(): void {
  const fake = createFakeFirestore();
  setFirestore(fake as unknown as Firestore);
}

export function resetFirestoreFake(): void {
  resetFirestore();
}
