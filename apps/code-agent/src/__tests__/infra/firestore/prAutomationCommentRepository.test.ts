/**
 * Tests for Firestore PR automation comment repository.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import {
  createFirestorePRAutomationCommentRepository,
} from '../../../infra/firestore/prAutomationCommentRepository.js';
import type { PRAutomationComment } from '../../../infra/firestore/prAutomationCommentRepository.js';

describe('FirestorePRAutomationCommentRepository', () => {
  let repo: ReturnType<typeof createFirestorePRAutomationCommentRepository>;

  const sampleComment: PRAutomationComment = {
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
    commentId: 99001,
    tokenUserId: 'user_abc123',
    eventCount: 1,
    createdAt: '2026-03-14T10:00:00.000Z',
    updatedAt: '2026-03-14T10:00:00.000Z',
  };

  beforeEach(() => {
    const fakeFirestore = createFakeFirestore() as unknown as Firestore;
    setFirestore(fakeFirestore);
    const logger = pino({ level: 'silent' });
    repo = createFirestorePRAutomationCommentRepository({ logger });
  });

  describe('get()', () => {
    it('returns undefined for non-existent document', async () => {
      const result = await repo.get('pbuchman/intexuraos', 42);

      expect(result).toBeUndefined();
    });
  });

  describe('create()', () => {
    it('stores document and get() retrieves it', async () => {
      await repo.create(sampleComment);

      const result = await repo.get('pbuchman/intexuraos', 42);

      expect(result).toBeDefined();
      expect(result?.repository).toBe('pbuchman/intexuraos');
      expect(result?.prNumber).toBe(42);
      expect(result?.commentId).toBe(99001);
      expect(result?.tokenUserId).toBe('user_abc123');
      expect(result?.eventCount).toBe(1);
      expect(result?.createdAt).toBe('2026-03-14T10:00:00.000Z');
      expect(result?.updatedAt).toBe('2026-03-14T10:00:00.000Z');
    });
  });

  describe('update()', () => {
    it('modifies eventCount and updatedAt', async () => {
      await repo.create(sampleComment);

      await repo.update('pbuchman/intexuraos', 42, {
        eventCount: 5,
        updatedAt: '2026-03-14T12:00:00.000Z',
      });

      const result = await repo.get('pbuchman/intexuraos', 42);

      expect(result).toBeDefined();
      expect(result?.eventCount).toBe(5);
      expect(result?.updatedAt).toBe('2026-03-14T12:00:00.000Z');
      // Other fields remain unchanged
      expect(result?.repository).toBe('pbuchman/intexuraos');
      expect(result?.prNumber).toBe(42);
      expect(result?.commentId).toBe(99001);
      expect(result?.tokenUserId).toBe('user_abc123');
      expect(result?.createdAt).toBe('2026-03-14T10:00:00.000Z');
    });
  });

  describe('document ID format', () => {
    it('uses {repository_with_slash_replaced}#{prNumber} as document ID', async () => {
      await repo.create(sampleComment);

      // Verify by accessing with correct repository + prNumber
      const found = await repo.get('pbuchman/intexuraos', 42);
      expect(found).toBeDefined();

      // Different prNumber returns undefined
      const notFound = await repo.get('pbuchman/intexuraos', 99);
      expect(notFound).toBeUndefined();

      // Different repository returns undefined
      const wrongRepo = await repo.get('other/repo', 42);
      expect(wrongRepo).toBeUndefined();
    });
  });

  describe('multiple PRs for the same repo', () => {
    it('stores separate documents that do not conflict', async () => {
      const comment1: PRAutomationComment = {
        ...sampleComment,
        prNumber: 10,
        commentId: 1001,
        eventCount: 3,
      };

      const comment2: PRAutomationComment = {
        ...sampleComment,
        prNumber: 20,
        commentId: 2002,
        eventCount: 7,
      };

      await repo.create(comment1);
      await repo.create(comment2);

      const result1 = await repo.get('pbuchman/intexuraos', 10);
      const result2 = await repo.get('pbuchman/intexuraos', 20);

      expect(result1).toBeDefined();
      expect(result1?.commentId).toBe(1001);
      expect(result1?.eventCount).toBe(3);

      expect(result2).toBeDefined();
      expect(result2?.commentId).toBe(2002);
      expect(result2?.eventCount).toBe(7);
    });
  });
});
