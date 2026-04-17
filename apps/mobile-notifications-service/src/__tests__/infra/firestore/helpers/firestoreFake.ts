import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore, resetFirestore, setFirestore, type FakeFirestore } from '@intexuraos/infra-firestore';

export function useFirestoreFake(): FakeFirestore {
  const fake = createFakeFirestore();
  setFirestore(fake as unknown as Firestore);
  return fake;
}

export function resetFirestoreFake(): void {
  resetFirestore();
}
