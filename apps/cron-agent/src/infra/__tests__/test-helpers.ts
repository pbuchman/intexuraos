import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@intexuraos/infra-firestore';

let fakeFirestore: ReturnType<typeof createFakeFirestore> | null = null;

export function initTestFirestore(): ReturnType<typeof createFakeFirestore> {
  fakeFirestore = createFakeFirestore();
  setFirestore(fakeFirestore as unknown as Firestore);
  return fakeFirestore;
}

export function cleanupTestFirestore(): void {
  resetFirestore();
  fakeFirestore = null;
}

export function createTestLogger(): {
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
  child: () => ReturnType<typeof createTestLogger>;
} {
  const logger: ReturnType<typeof createTestLogger> = {
    info: () => { /* noop */ },
    warn: () => { /* noop */ },
    error: () => { /* noop */ },
    debug: () => { /* noop */ },
    child: () => createTestLogger(),
  };
  return logger;
}
