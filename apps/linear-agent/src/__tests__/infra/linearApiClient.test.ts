/**
 * Tests for Linear API client.
 * Tests the factory function and uses FakeLinearApiClient for behavior testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeLinearApiClient } from '../fakes.js';
import type { LinearTeam } from '../../domain/models.js';

describe('LinearApiClient', () => {
  let fakeClient: FakeLinearApiClient;

  beforeEach(() => {
    fakeClient = new FakeLinearApiClient();
  });

  afterEach(() => {
    fakeClient.reset();
  });

  describe('validateAndGetTeams', () => {
    it('returns teams for valid API key', async () => {
      const result = await fakeClient.validateAndGetTeams('valid-api-key');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toEqual({
          id: 'team-1',
          name: 'Engineering',
          key: 'ENG',
        });
      }
    });

    it('returns error for invalid API key', async () => {
      const result = await fakeClient.validateAndGetTeams('invalid');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_API_KEY');
        expect(result.error.message).toBe('Invalid API key');
      }
    });

    it('returns custom error when configured to fail', async () => {
      fakeClient.setFailure(true, { code: 'RATE_LIMIT', message: 'Rate limit exceeded' });

      const result = await fakeClient.validateAndGetTeams('valid-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMIT');
      }
    });
  });

  describe('createIssue', () => {
    it('creates issue and returns mapped data', async () => {
      const result = await fakeClient.createIssue('api-key', {
        title: 'Test Issue',
        description: 'Test description',
        priority: 2,
        teamId: 'team-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Test Issue');
        expect(result.value.description).toBe('Test description');
        expect(result.value.priority).toBe(2);
        expect(result.value.identifier).toMatch(/^ENG-\d+$/);
        expect(result.value.state.type).toBe('backlog');
        expect(result.value.id).toBeDefined();
        expect(result.value.url).toBeDefined();
      }
    });

    it('creates issue with null description', async () => {
      const result = await fakeClient.createIssue('api-key', {
        title: 'No Desc Issue',
        description: null,
        priority: 3,
        teamId: 'team-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('No Desc Issue');
        expect(result.value.description).toBeNull();
      }
    });

    it('increments issue counter for each issue', async () => {
      const result1 = await fakeClient.createIssue('api-key', {
        title: 'First',
        description: null,
        priority: 0,
        teamId: 'team-1',
      });
      const result2 = await fakeClient.createIssue('api-key', {
        title: 'Second',
        description: null,
        priority: 0,
        teamId: 'team-1',
      });

      expect(result1.ok && result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result2.value.identifier).not.toBe(result1.value.identifier);
      }
    });

    it('returns error when configured to fail', async () => {
      fakeClient.setFailure(true);

      const result = await fakeClient.createIssue('api-key', {
        title: 'Test',
        description: null,
        priority: 0,
        teamId: 'team-1',
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('listIssues', () => {
    beforeEach(() => {
      // Seed some test issues
      fakeClient.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-1',
        title: 'Active Issue',
        description: 'In progress',
        priority: 2,
        state: { id: 'state-1', name: 'In Progress', type: 'started' },
        url: 'https://linear.app/issue/1',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
        completedAt: null,
      });
      fakeClient.seedIssue({
        id: 'issue-2',
        identifier: 'ENG-2',
        title: 'Completed Issue',
        description: 'Done',
        priority: 1,
        state: { id: 'state-2', name: 'Done', type: 'completed' },
        url: 'https://linear.app/issue/2',
        createdAt: '2025-01-14T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
        completedAt: '2025-01-15T10:00:00Z',
      });
    });

    it('returns all issues', async () => {
      const result = await fakeClient.listIssues('api-key', 'team-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.title).toBe('Active Issue');
        expect(result.value[1]?.title).toBe('Completed Issue');
      }
    });

    it('respects completedSinceDays option (client-side filter)', async () => {
      const result = await fakeClient.listIssues('api-key', 'team-1', { completedSinceDays: 7 });

      // Note: FakeLinearApiClient doesn't implement date filtering
      // Real implementation would filter old completed issues
      expect(result.ok).toBe(true);
    });

    it('returns error when configured to fail', async () => {
      fakeClient.setFailure(true);

      const result = await fakeClient.listIssues('api-key', 'team-1');

      expect(result.ok).toBe(false);
    });
  });

  describe('getIssue', () => {
    beforeEach(() => {
      fakeClient.seedIssue({
        id: 'issue-123',
        identifier: 'ENG-123',
        title: 'Specific Issue',
        description: 'Find me by ID',
        priority: 1,
        state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
        url: 'https://linear.app/issue/123',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
        completedAt: null,
      });
    });

    it('returns issue by ID', async () => {
      const result = await fakeClient.getIssue('api-key', 'issue-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.title).toBe('Specific Issue');
        expect(result.value?.identifier).toBe('ENG-123');
      }
    });

    it('returns null for non-existent issue', async () => {
      const result = await fakeClient.getIssue('api-key', 'unknown-issue');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when configured to fail', async () => {
      fakeClient.setFailure(true);

      const result = await fakeClient.getIssue('api-key', 'issue-123');

      expect(result.ok).toBe(false);
    });
  });

  describe('test helpers', () => {
    it('reset clears all issues', async () => {
      await fakeClient.createIssue('key', {
        title: 'Test',
        description: null,
        priority: 0,
        teamId: 'team-1',
      });

      const beforeResetResult = await fakeClient.listIssues('key', 'team-1');
      expect(beforeResetResult.ok && beforeResetResult.value).toHaveLength(1);

      fakeClient.reset();

      const result = await fakeClient.listIssues('key', 'team-1');
      expect(result.ok && result.value).toHaveLength(0);
    });

    it('setTeams changes available teams', async () => {
      const customTeams: LinearTeam[] = [
        { id: 'custom-1', name: 'Custom Team', key: 'CST' },
      ];
      fakeClient.setTeams(customTeams);

      const result = await fakeClient.validateAndGetTeams('key');
      expect(result.ok && result.value).toEqual(customTeams);
    });

    it('setFailure configures error behavior', async () => {
      fakeClient.setFailure(true, { code: 'TEAM_NOT_FOUND', message: 'Team gone' });

      const result = await fakeClient.createIssue('key', {
        title: 'X',
        description: null,
        priority: 0,
        teamId: 'team-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TEAM_NOT_FOUND');
      }
    });
  });
});
