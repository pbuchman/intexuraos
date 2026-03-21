/**
 * Tests for checkIdempotency.ts - checkProcessedAction function.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { ProcessedAction } from '../../../domain/models.js';
import { checkProcessedAction } from '../../../domain/useCases/checkIdempotency.js';
import { FakeProcessedActionRepository } from '../../fakes.js';

const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

describe('checkProcessedAction', () => {
  let fakeRepo: FakeProcessedActionRepository;

  beforeEach(() => {
    fakeRepo = new FakeProcessedActionRepository();
  });

  afterEach(() => {
    fakeRepo.reset();
  });

  describe('when action has not been processed', () => {
    it('returns ok(null) to indicate caller should continue', async () => {
      const result = await checkProcessedAction('new-action-id', {
        repository: fakeRepo,
        logger: NOOP_LOGGER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('does not return any service feedback', async () => {
      const result = await checkProcessedAction('action-123', {
        repository: fakeRepo,
        logger: NOOP_LOGGER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('when action has already been processed', () => {
    const existingAction: ProcessedAction = {
      actionId: 'action-123',
      userId: 'user-456',
      issueId: 'issue-789',
      issueIdentifier: 'ENG-42',
      resourceUrl: 'https://linear.app/team/issue/ENG-42',
      createdAt: '2025-01-15T00:00:00Z',
    };

    it('returns ok with ServiceFeedback containing existing issue info', async () => {
      fakeRepo.seedProcessedAction(existingAction);

      const result = await checkProcessedAction('action-123', {
        repository: fakeRepo,
        logger: NOOP_LOGGER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.status).toBe('completed');
        expect(result.value?.message).toBe('Issue ENG-42 created successfully');
        expect(result.value?.resourceUrl).toBe('https://linear.app/team/issue/ENG-42');
      }
    });

    it('indicates caller should return early (not continue)', async () => {
      fakeRepo.seedProcessedAction(existingAction);

      const result = await checkProcessedAction('action-123', {
        repository: fakeRepo,
        logger: NOOP_LOGGER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // null would mean continue, non-null means return early
        expect(result.value).not.toBeNull();
      }
    });
  });

  describe('when repository check fails', () => {
    it('returns err with the repository error', async () => {
      class FailingRepo extends FakeProcessedActionRepository {
        override async getByActionId(): ReturnType<
          FakeProcessedActionRepository['getByActionId']
        > {
          return Promise.resolve(
            err({ code: 'INTERNAL_ERROR', message: 'Database connection failed' })
          );
        }
      }

      const failingRepo = new FailingRepo();
      const result = await checkProcessedAction('action-123', {
        repository: failingRepo,
        logger: NOOP_LOGGER,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database connection failed');
      }
    });
  });
});
