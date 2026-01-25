/**
 * Tests for FirestoreLogChunkRepository
 *
 * Note: Fake firestore doesn't support subcollection chaining (collection().doc().collection()),
 * so we test this repository through integration tests in webhooks.test.ts instead.
 */

import { describe, expect, it } from 'vitest';
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { createFirestoreLogChunkRepository } from '../../../infra/repositories/firestoreLogChunkRepository.js';

describe('createFirestoreLogChunkRepository', () => {
  it('creates repository instance', () => {
    const fakeFirestore = createFakeFirestore();
    const logger = pino({ name: 'test' }) as unknown as Logger;

    const repo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    expect(repo).toBeDefined();
    expect(repo.storeBatch).toBeInstanceOf(Function);
  });

  // Note: Additional storeBatch tests are covered in webhooks.test.ts integration tests
  // because fake firestore doesn't support subcollection chaining (collection().doc().collection())
});
