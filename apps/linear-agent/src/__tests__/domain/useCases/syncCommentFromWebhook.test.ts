/**
 * Tests for syncCommentFromWebhook use case.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import type { LinearCommentWebhookEvent, LinearError } from '../../../domain/index.js';
import { syncCommentFromWebhook } from '../../../domain/useCases/syncCommentFromWebhook.js';
import { FakeLinearCommentRepository } from '../../fakes.js';

describe('syncCommentFromWebhook', () => {
  let commentRepo: FakeLinearCommentRepository;
  let logger: pino.Logger;

  beforeEach(() => {
    commentRepo = new FakeLinearCommentRepository();
    logger = pino({ level: 'silent' });
  });

  const createWebhookEvent = (
    action: 'create' | 'update' | 'remove',
    overrides?: Partial<LinearCommentWebhookEvent>
  ): LinearCommentWebhookEvent => ({
    action,
    type: 'Comment',
    webhookTimestamp: Date.now(),
    webhookId: 'wh-test',
    data: {
      id: 'comment-123',
      issueId: 'issue-456',
      issueIdentifier: 'INT-123',
      user: { id: 'user-789', name: 'Test User' },
      body: 'Test comment body',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    ...overrides,
  });

  describe('create action', () => {
    it('saves comment and returns created result', async () => {
      const event = createWebhookEvent('create');

      const result = await syncCommentFromWebhook(event, 'user-123', {
        commentRepo,
        logger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('created');
        expect(result.value.commentId).toBe('comment-123');
      }

      const savedComment = await commentRepo.findById('comment-123');
      expect(savedComment.ok).toBe(true);
      if (savedComment.ok) {
        expect(savedComment.value).not.toBeNull();
        expect(savedComment.value?.id).toBe('comment-123');
        expect(savedComment.value?.issueId).toBe('issue-456');
        expect(savedComment.value?.issueIdentifier).toBe('INT-123');
        expect(savedComment.value?.userId).toBe('user-789');
        expect(savedComment.value?.userName).toBe('Test User');
        expect(savedComment.value?.body).toBe('Test comment body');
      }
    });

    it('returns error when save fails', async () => {
      const event = createWebhookEvent('create');
      const expectedError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };
      commentRepo.setSaveFailure(true, expectedError);

      const result = await syncCommentFromWebhook(event, 'user-123', {
        commentRepo,
        logger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(expectedError);
      }
    });
  });

  describe('update action', () => {
    it('saves comment and returns updated result', async () => {
      const event = createWebhookEvent('update', {
        data: {
          id: 'comment-123',
          issueId: 'issue-456',
          issueIdentifier: 'INT-123',
          user: { id: 'user-789', name: 'Test User' },
          body: 'Updated comment body',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
        },
      });

      const result = await syncCommentFromWebhook(event, 'user-123', {
        commentRepo,
        logger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('updated');
        expect(result.value.commentId).toBe('comment-123');
      }

      const savedComment = await commentRepo.findById('comment-123');
      expect(savedComment.ok).toBe(true);
      if (savedComment.ok) {
        expect(savedComment.value).not.toBeNull();
        expect(savedComment.value?.body).toBe('Updated comment body');
        expect(savedComment.value?.updatedAt).toBe('2025-01-02T00:00:00Z');
      }
    });

    it('returns error when save fails', async () => {
      const event = createWebhookEvent('update');
      const expectedError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };
      commentRepo.setSaveFailure(true, expectedError);

      const result = await syncCommentFromWebhook(event, 'user-123', {
        commentRepo,
        logger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(expectedError);
      }
    });
  });

  describe('remove action', () => {
    it('deletes comment and returns deleted result', async () => {
      const event = createWebhookEvent('remove');

      const result = await syncCommentFromWebhook(event, 'user-123', {
        commentRepo,
        logger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('deleted');
        expect(result.value.commentId).toBe('comment-123');
      }
    });

    it('returns error when delete fails', async () => {
      const event = createWebhookEvent('remove');
      const expectedError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };
      commentRepo.setDeleteByIdFailure(true, expectedError);

      const result = await syncCommentFromWebhook(event, 'user-123', {
        commentRepo,
        logger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(expectedError);
      }
    });
  });

  describe('unknown action', () => {
    it('returns skipped result for unknown action', async () => {
      const event = createWebhookEvent('create');
      (event as LinearCommentWebhookEvent).action = 'archive' as unknown as 'create';

      const result = await syncCommentFromWebhook(event, 'user-123', {
        commentRepo,
        logger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('skipped');
        expect(result.value.commentId).toBe('comment-123');
      }
    });
  });
});
