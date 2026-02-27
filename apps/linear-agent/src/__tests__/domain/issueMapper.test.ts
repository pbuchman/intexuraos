/**
 * Tests for issueMapper.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { mapWebhookToSyncedIssue, mapApiIssueToSyncedIssue } from '../../domain/issueMapper.js';
import type { LinearWebhookPayload } from '../../domain/webhookTypes.js';
import type { LinearIssue } from '../../domain/index.js';

describe('issueMapper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const userId = 'user-123';

  function createWebhookPayload(overrides: Partial<LinearWebhookPayload> = {}): LinearWebhookPayload {
    return {
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
      labels: [{ id: 'label-1', name: 'bug' }, { id: 'label-2', name: 'frontend' }],
      team: { id: 'team-1', key: 'INT' },
      ...overrides,
    };
  }

  describe('mapWebhookToSyncedIssue', () => {
    it('maps all fields correctly', () => {
      const payload = createWebhookPayload();

      const result = mapWebhookToSyncedIssue(payload, userId);

      expect(result.id).toBe('issue-uuid-1');
      expect(result.identifier).toBe('INT-123');
      expect(result.title).toBe('Test Issue');
      expect(result.description).toBe('Test description');
      expect(result.state).toBe('In Progress');
      expect(result.stateType).toBe('started');
      expect(result.priority).toBe(2);
      expect(result.assigneeId).toBe('user-1');
      expect(result.assigneeName).toBe('Test User');
      expect(result.labels).toEqual([
        { id: 'label-1', name: 'bug', color: '' },
        { id: 'label-2', name: 'frontend', color: '' },
      ]);
      expect(result.url).toBe('https://linear.app/team/issue/INT-123');
      expect(result.userId).toBe(userId);
      expect(result.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(result.updatedAt).toBe('2025-01-02T00:00:00.000Z');
      expect(result.syncedAt).toBe('2025-01-15T12:00:00.000Z');
      expect(result.teamId).toBe('team-1');
    });

    it('handles null assignee', () => {
      const payload = createWebhookPayload({ assignee: null });

      const result = mapWebhookToSyncedIssue(payload, userId);

      expect(result.assigneeId).toBeNull();
      expect(result.assigneeName).toBeNull();
    });

    it('handles empty labels', () => {
      const payload = createWebhookPayload({ labels: [] });

      const result = mapWebhookToSyncedIssue(payload, userId);

      expect(result.labels).toEqual([]);
    });

    it('handles null description', () => {
      const payload = createWebhookPayload({ description: null });

      const result = mapWebhookToSyncedIssue(payload, userId);

      expect(result.description).toBeNull();
    });

    it('parses valid state types', () => {
      const stateTypes = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'];

      for (const type of stateTypes) {
        const payload = createWebhookPayload({ state: { id: 'state-1', name: 'Test', type } });
        const result = mapWebhookToSyncedIssue(payload, userId);
        expect(result.stateType).toBe(type);
      }
    });

    it('defaults unknown state types to unstarted', () => {
      const payload = createWebhookPayload({ state: { id: 'state-1', name: 'Test', type: 'unknown' } });

      const result = mapWebhookToSyncedIssue(payload, userId);

      expect(result.stateType).toBe('unstarted');
    });

    it('parses valid priority values', () => {
      for (let priority = 0; priority <= 4; priority++) {
        const payload = createWebhookPayload({ priority });
        const result = mapWebhookToSyncedIssue(payload, userId);
        expect(result.priority).toBe(priority);
      }
    });

    it('defaults invalid priority to 0', () => {
      const payload = createWebhookPayload({ priority: 99 });

      const result = mapWebhookToSyncedIssue(payload, userId);

      expect(result.priority).toBe(0);
    });
  });

  describe('mapApiIssueToSyncedIssue', () => {
    function createApiIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
      return {
        id: 'issue-uuid-2',
        identifier: 'INT-456',
        title: 'API Issue',
        description: 'API description',
        priority: 1,
        state: { id: 'state-2', name: 'Todo', type: 'unstarted' },
        url: 'https://linear.app/team/issue/INT-456',
        createdAt: '2025-01-03T00:00:00.000Z',
        updatedAt: '2025-01-04T00:00:00.000Z',
        completedAt: null,
        childCount: 0,
        children: [],
        labels: [],
        ...overrides,
      };
    }

    it('maps all fields correctly', () => {
      const issue = createApiIssue();

      const result = mapApiIssueToSyncedIssue(issue, userId, 'team-1');

      expect(result.id).toBe('issue-uuid-2');
      expect(result.identifier).toBe('INT-456');
      expect(result.title).toBe('API Issue');
      expect(result.description).toBe('API description');
      expect(result.state).toBe('Todo');
      expect(result.stateType).toBe('unstarted');
      expect(result.priority).toBe(1);
      expect(result.userId).toBe(userId);
      expect(result.syncedAt).toBe('2025-01-15T12:00:00.000Z');
      expect(result.teamId).toBe('team-1');
    });

    it('preserves assignee data when present', () => {
      const issue = createApiIssue({
        assignee: { id: 'assignee-1', name: 'Jane Doe' },
      });

      const result = mapApiIssueToSyncedIssue(issue, userId, 'team-1');

      expect(result.assigneeId).toBe('assignee-1');
      expect(result.assigneeName).toBe('Jane Doe');
    });

    it('handles null assignee', () => {
      const issue = createApiIssue({ assignee: null });

      const result = mapApiIssueToSyncedIssue(issue, userId, 'team-1');

      expect(result.assigneeId).toBeNull();
      expect(result.assigneeName).toBeNull();
    });

    it('handles undefined assignee (field not set)', () => {
      const issue = createApiIssue();

      const result = mapApiIssueToSyncedIssue(issue, userId, 'team-1');

      expect(result.assigneeId).toBeNull();
      expect(result.assigneeName).toBeNull();
    });

    it('sets labels to empty array (not available in API response)', () => {
      const issue = createApiIssue();

      const result = mapApiIssueToSyncedIssue(issue, userId, 'team-1');

      expect(result.labels).toEqual([]);
    });

    it('includes labels from API response', () => {
      const issue = createApiIssue({
        labels: [
          { id: 'label-1', name: 'bug', color: '#ff0000' },
          { id: 'label-2', name: 'frontend', color: '#00ff00' },
        ],
      });

      const result = mapApiIssueToSyncedIssue(issue, userId, 'team-1');

      expect(result.labels).toEqual([
        { id: 'label-1', name: 'bug', color: '#ff0000' },
        { id: 'label-2', name: 'frontend', color: '#00ff00' },
      ]);
    });
  });
});
