/**
 * Tests for syncSingleIssueUseCase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSingleIssue, type SyncSingleIssueDeps } from '../../../domain/useCases/syncSingleIssueUseCase.js';
import type { LinearWebhookEvent } from '../../../domain/webhookTypes.js';
import { FakeLinearIssueRepository } from '../../fakes.js';
import { createFakeLogger } from '../../testUtils.js';

function createTestEvent(overrides: Partial<LinearWebhookEvent> = {}): LinearWebhookEvent {
  return {
    action: 'create',
    type: 'Issue',
    webhookTimestamp: Date.now(),
    webhookId: 'webhook-123',
    data: {
      id: 'issue-uuid-1',
      identifier: 'INT-123',
      title: 'Test Issue',
      description: 'Test description',
      priority: 2,
      url: 'https://linear.app/team/issue/INT-123',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      state: { id: 'state-1', name: 'In Progress', type: 'started' },
      assignee: { id: 'user-1', name: 'Test User' },
      labels: [{ id: 'label-1', name: 'bug' }],
      team: { id: 'team-1', key: 'INT' },
    },
    ...overrides,
  };
}

describe('syncSingleIssue', () => {
  let issueRepo: FakeLinearIssueRepository;
  let deps: SyncSingleIssueDeps;
  const userId = 'user-123';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
    issueRepo = new FakeLinearIssueRepository();
    deps = {
      issueRepo,
      logger: createFakeLogger(),
    };
  });

  describe('create action', () => {
    it('saves new issue to repository', async () => {
      const event = createTestEvent({ action: 'create' });

      const result = await syncSingleIssue(event, userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('created');
        expect(result.value.issueId).toBe('issue-uuid-1');
      }
      expect(issueRepo.count).toBe(1);
    });

    it('maps all fields correctly', async () => {
      const event = createTestEvent({ action: 'create' });

      await syncSingleIssue(event, userId, deps);

      const saved = await issueRepo.findById('issue-uuid-1');
      expect(saved.ok).toBe(true);
      if (saved.ok && saved.value) {
        expect(saved.value.identifier).toBe('INT-123');
        expect(saved.value.title).toBe('Test Issue');
        expect(saved.value.state).toBe('In Progress');
        expect(saved.value.stateType).toBe('started');
        expect(saved.value.priority).toBe(2);
        expect(saved.value.assigneeId).toBe('user-1');
        expect(saved.value.assigneeName).toBe('Test User');
        expect(saved.value.labels).toEqual([{ id: 'label-1', name: 'bug', color: '' }]);
        expect(saved.value.userId).toBe(userId);
      }
    });
  });

  describe('update action', () => {
    it('updates existing issue', async () => {
      const createEvent = createTestEvent({ action: 'create' });
      await syncSingleIssue(createEvent, userId, deps);

      const updateEvent = createTestEvent({
        action: 'update',
        data: {
          ...createEvent.data,
          title: 'Updated Title',
        },
      });

      const result = await syncSingleIssue(updateEvent, userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('updated');
      }

      const saved = await issueRepo.findById('issue-uuid-1');
      if (saved.ok && saved.value) {
        expect(saved.value.title).toBe('Updated Title');
      }
    });
  });

  describe('remove action', () => {
    it('deletes issue from repository', async () => {
      const createEvent = createTestEvent({ action: 'create' });
      await syncSingleIssue(createEvent, userId, deps);
      expect(issueRepo.count).toBe(1);

      const removeEvent = createTestEvent({ action: 'remove' });

      const result = await syncSingleIssue(removeEvent, userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('deleted');
      }
      expect(issueRepo.count).toBe(0);
    });

    it('only deletes the owning user copy when another user has the same issue', async () => {
      const otherUserId = 'other-user';

      // Both users have the same issue
      const createEvent = createTestEvent({ action: 'create' });
      await syncSingleIssue(createEvent, userId, deps);
      await syncSingleIssue(createEvent, otherUserId, deps);
      expect(issueRepo.count).toBe(2);

      // Remove event for the first user only
      const removeEvent = createTestEvent({ action: 'remove' });
      const result = await syncSingleIssue(removeEvent, userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('deleted');
      }

      // Only one copy should remain — the other user's
      expect(issueRepo.count).toBe(1);
      const otherUserIssues = await issueRepo.listByUserId(otherUserId);
      expect(otherUserIssues.ok).toBe(true);
      if (otherUserIssues.ok) {
        expect(otherUserIssues.value).toHaveLength(1);
      }
    });
  });

  describe('error handling', () => {
    it('returns error when repository save fails', async () => {
      issueRepo.setFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });
      const event = createTestEvent({ action: 'create' });

      const result = await syncSingleIssue(event, userId, deps);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when repository delete fails', async () => {
      issueRepo.setFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });
      const event = createTestEvent({ action: 'remove' });

      const result = await syncSingleIssue(event, userId, deps);

      expect(result.ok).toBe(false);
    });
  });

  describe('unknown action', () => {
    it('skips unknown actions', async () => {
      const event = createTestEvent();
      (event as { action: string }).action = 'unknown';

      const result = await syncSingleIssue(event as LinearWebhookEvent, userId, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('skipped');
      }
    });
  });
});
