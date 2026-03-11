/**
 * Tests for Firestore dispatch retry repository.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import { createFirestoreDispatchRetryRepository } from '../../../infra/firestore/dispatchRetryRepository.js';
import type { CreateDispatchRetryInput } from '../../../domain/models/dispatchRetry.js';

describe('FirestoreDispatchRetryRepository', () => {
  let repo: ReturnType<typeof createFirestoreDispatchRetryRepository>;

  const sampleInput: CreateDispatchRetryInput = {
    type: 'new_task',
    eventId: 'evt_123',
    repository: 'intexuraos/test-repo',
    pullRequestNumber: 42,
    senderLogin: 'testuser',
    taskId: 'task_abc',
    comment: 'fix the bug',
    attempts: 0,
    maxAttempts: 3,
    lastError: 'worker_unavailable: connection refused',
    ttlMinutes: 10,
  };

  beforeEach(() => {
    const fakeFirestore = createFakeFirestore() as unknown as Firestore;
    setFirestore(fakeFirestore);
    const logger = pino({ level: 'silent' });
    repo = createFirestoreDispatchRetryRepository({ logger });
  });

  describe('create', () => {
    it('creates a dispatch retry entry with generated ID and createdAt', async () => {
      const result = await repo.create(sampleInput);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toMatch(/^dr_/);
      expect(result.value.type).toBe('new_task');
      expect(result.value.eventId).toBe('evt_123');
      expect(result.value.repository).toBe('intexuraos/test-repo');
      expect(result.value.pullRequestNumber).toBe(42);
      expect(result.value.senderLogin).toBe('testuser');
      expect(result.value.taskId).toBe('task_abc');
      expect(result.value.comment).toBe('fix the bug');
      expect(result.value.attempts).toBe(0);
      expect(result.value.maxAttempts).toBe(3);
      expect(result.value.lastError).toBe('worker_unavailable: connection refused');
      expect(result.value.ttlMinutes).toBe(10);
      expect(result.value.createdAt).toBeDefined();
    });
  });

  describe('findOldest', () => {
    it('returns null when no entries exist', async () => {
      const result = await repo.findOldest();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('returns the oldest entry by createdAt', async () => {
      // Create two entries — the first should be returned
      const result1 = await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        eventId: 'evt_456',
        lastError: 'network_error',
      });

      const findResult = await repo.findOldest();

      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.value).not.toBeNull();
      if (findResult.value === null) return;
      expect(findResult.value.eventId).toBe('evt_123');
      if (!result1.ok) return;
      expect(findResult.value.id).toBe(result1.value.id);
    });
  });

  describe('delete', () => {
    it('deletes an existing entry', async () => {
      const createResult = await repo.create(sampleInput);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const deleteResult = await repo.delete(createResult.value.id);
      expect(deleteResult.ok).toBe(true);

      // Verify entry is gone
      const findResult = await repo.findOldest();
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.value).toBeNull();
    });
  });

  describe('update', () => {
    it('updates retry metadata fields', async () => {
      const createResult = await repo.create(sampleInput);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const updateResult = await repo.update(createResult.value.id, {
        attempts: 1,
        lastAttemptAt: new Date('2025-01-15T10:00:00Z'),
        lastError: 'network_error: timeout',
      });
      expect(updateResult.ok).toBe(true);

      // Verify updated values
      const findResult = await repo.findOldest();
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.value).not.toBeNull();
      if (findResult.value === null) return;
      expect(findResult.value.attempts).toBe(1);
      expect(findResult.value.lastError).toBe('network_error: timeout');
    });
  });

  describe('task_message type', () => {
    it('creates a task_message retry entry', async () => {
      const messageInput: CreateDispatchRetryInput = {
        type: 'task_message',
        eventId: 'evt_789',
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 10,
        senderLogin: 'testuser',
        taskId: 'task_xyz',
        userId: 'user_123',
        message: 'please also fix the tests',
        attempts: 0,
        maxAttempts: 3,
        lastError: 'worker_unavailable',
        ttlMinutes: 10,
      };

      const result = await repo.create(messageInput);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe('task_message');
      expect(result.value.userId).toBe('user_123');
      expect(result.value.message).toBe('please also fix the tests');
    });
  });

  describe('optional field handling', () => {
    it('creates entry with prTitle and baseBranch when provided', async () => {
      const inputWithOptionals: CreateDispatchRetryInput = {
        ...sampleInput,
        prTitle: 'Fix auth flow',
        baseBranch: 'main',
      };

      const result = await repo.create(inputWithOptionals);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.prTitle).toBe('Fix auth flow');
      expect(result.value.baseBranch).toBe('main');
    });

    it('creates entry without prTitle and baseBranch when not provided', async () => {
      const minimalInput: CreateDispatchRetryInput = {
        type: 'new_task',
        eventId: 'evt_minimal',
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 1,
        senderLogin: 'testuser',
        attempts: 0,
        maxAttempts: 3,
        lastError: 'worker_unavailable',
        ttlMinutes: 10,
      };

      const result = await repo.create(minimalInput);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.prTitle).toBeUndefined();
      expect(result.value.baseBranch).toBeUndefined();
    });

    it('findOldest returns optional fields when present in stored data', async () => {
      const inputWithAll: CreateDispatchRetryInput = {
        type: 'task_message',
        eventId: 'evt_full',
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 5,
        senderLogin: 'testuser',
        taskId: 'task_full',
        comment: 'a comment',
        prTitle: 'PR title',
        baseBranch: 'develop',
        userId: 'user_456',
        message: 'a message',
        attempts: 1,
        maxAttempts: 3,
        lastError: 'network_error',
        ttlMinutes: 15,
      };

      await repo.create(inputWithAll);

      // Also update to set lastAttemptAt
      const createResult = await repo.create(inputWithAll);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      await repo.update(createResult.value.id, {
        attempts: 2,
        lastAttemptAt: new Date('2025-06-01T12:00:00Z'),
        lastError: 'retry error',
      });

      // Delete the first entry so findOldest returns the updated one
      const firstFind = await repo.findOldest();
      expect(firstFind.ok).toBe(true);
      if (!firstFind.ok) return;
      if (firstFind.value === null) return;
      if (firstFind.value.id !== createResult.value.id) {
        await repo.delete(firstFind.value.id);
      }

      const findResult = await repo.findOldest();
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.value).not.toBeNull();
      if (findResult.value === null) return;

      expect(findResult.value.prTitle).toBe('PR title');
      expect(findResult.value.baseBranch).toBe('develop');
      expect(findResult.value.userId).toBe('user_456');
      expect(findResult.value.message).toBe('a message');
      expect(findResult.value.lastAttemptAt).toBeDefined();
    });

    it('findOldest omits optional fields when not present in stored data', async () => {
      const minimalInput: CreateDispatchRetryInput = {
        type: 'new_task',
        eventId: 'evt_no_opts',
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 7,
        senderLogin: 'testuser',
        attempts: 0,
        maxAttempts: 3,
        lastError: 'worker_unavailable',
        ttlMinutes: 10,
      };

      await repo.create(minimalInput);

      const findResult = await repo.findOldest();
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.value).not.toBeNull();
      if (findResult.value === null) return;

      expect(findResult.value.prTitle).toBeUndefined();
      expect(findResult.value.baseBranch).toBeUndefined();
      expect(findResult.value.userId).toBeUndefined();
      expect(findResult.value.message).toBeUndefined();
      expect(findResult.value.lastAttemptAt).toBeUndefined();
    });
  });
});
