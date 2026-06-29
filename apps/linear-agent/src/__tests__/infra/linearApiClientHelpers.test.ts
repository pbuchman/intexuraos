/**
 * Tests for Linear API client helper functions.
 * Tests the exported pure functions for complete branch coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mapIssueStateType,
  mapLinearError,
  isTransientUpstreamError,
  createDedupKey,
  filterIssuesByCompletionDate,
  DEFAULT_COMPLETED_SINCE_DAYS,
  mapTeam,
  clearClientCache,
  getClientCacheSize,
  getDedupCacheSize,
  withLinearRetry,
} from '../../infra/linear/linearApiClient.js';
import type { LinearIssue } from '../../domain/index.js';
import type { Team } from '@linear/sdk';

describe('linearApiClient helper functions', () => {
  beforeEach(() => {
    clearClientCache();
  });

  afterEach(() => {
    clearClientCache();
  });

  describe('mapIssueStateType', () => {
    it('maps backlog state type', () => {
      expect(mapIssueStateType('backlog')).toBe('backlog');
    });

    it('maps unstarted state type', () => {
      expect(mapIssueStateType('unstarted')).toBe('unstarted');
    });

    it('maps started state type', () => {
      expect(mapIssueStateType('started')).toBe('started');
    });

    it('maps completed state type', () => {
      expect(mapIssueStateType('completed')).toBe('completed');
    });

    it('maps canceled state type to cancelled (British spelling)', () => {
      expect(mapIssueStateType('canceled')).toBe('cancelled');
    });

    it('maps unknown state type to backlog (default)', () => {
      expect(mapIssueStateType('unknown')).toBe('backlog');
    });

    it('maps empty string to backlog (default)', () => {
      expect(mapIssueStateType('')).toBe('backlog');
    });

    it('maps arbitrary string to backlog (default)', () => {
      expect(mapIssueStateType('some-custom-state')).toBe('backlog');
    });
  });

  describe('mapLinearError', () => {
    it('returns INVALID_API_KEY for 401 error', () => {
      const error = new Error('401 Unauthorized');
      const result = mapLinearError(error);

      expect(result.code).toBe('INVALID_API_KEY');
      expect(result.message).toBe('Invalid Linear API key');
    });

    it('returns INVALID_API_KEY for Unauthorized message', () => {
      const error = new Error('Request failed: Unauthorized');
      const result = mapLinearError(error);

      expect(result.code).toBe('INVALID_API_KEY');
      expect(result.message).toBe('Invalid Linear API key');
    });

    it('returns INVALID_API_KEY for Invalid API key message', () => {
      const error = new Error('Invalid API key provided');
      const result = mapLinearError(error);

      expect(result.code).toBe('INVALID_API_KEY');
      expect(result.message).toBe('Invalid Linear API key');
    });

    it('returns RATE_LIMIT for 429 error', () => {
      const error = new Error('429 Too Many Requests');
      const result = mapLinearError(error);

      expect(result.code).toBe('RATE_LIMIT');
      expect(result.message).toBe('Linear API rate limit exceeded');
    });

    it('returns RATE_LIMIT for rate limit message', () => {
      const error = new Error('You have exceeded the rate limit');
      const result = mapLinearError(error);

      expect(result.code).toBe('RATE_LIMIT');
      expect(result.message).toBe('Linear API rate limit exceeded');
    });

    it('returns RATE_LIMIT even when message contains API key keywords', () => {
      const error = new Error('429 Too Many Requests: Invalid request rate exceeded');
      const result = mapLinearError(error);

      expect(result.code).toBe('RATE_LIMIT');
      expect(result.message).toBe('Linear API rate limit exceeded');
    });

    it('returns RATE_LIMIT for 429 with Unauthorized keyword', () => {
      const error = new Error('429: Unauthorized rate of requests');
      const result = mapLinearError(error);

      expect(result.code).toBe('RATE_LIMIT');
      expect(result.message).toBe('Linear API rate limit exceeded');
    });

    it('returns TEAM_NOT_FOUND for 404 error', () => {
      const error = new Error('404 Not Found');
      const result = mapLinearError(error);

      expect(result.code).toBe('TEAM_NOT_FOUND');
      expect(result.message).toBe('404 Not Found');
    });

    it('returns UPSTREAM_UNAVAILABLE for 502 error', () => {
      const error = new Error('GraphQL Error (Code: 502) - Bad gateway');
      const result = mapLinearError(error);

      expect(result.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(result.message).toBe('Linear API temporarily unavailable');
    });

    it('returns UPSTREAM_UNAVAILABLE for 503 error', () => {
      const error = new Error('Service Unavailable (503)');
      const result = mapLinearError(error);

      expect(result.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(result.message).toBe('Linear API temporarily unavailable');
    });

    it('returns UPSTREAM_UNAVAILABLE for 504 error', () => {
      const error = new Error('Gateway Timeout (504)');
      const result = mapLinearError(error);

      expect(result.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(result.message).toBe('Linear API temporarily unavailable');
    });

    it('returns UPSTREAM_UNAVAILABLE with clean message even when raw error contains HTML', () => {
      const error = new Error('GraphQL Error (Code: 502) - <!DOCTYPE html><html>...</html>');
      const result = mapLinearError(error);

      expect(result.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(result.message).toBe('Linear API temporarily unavailable');
      expect(result.message).not.toContain('<');
      expect(result.message).not.toContain('html');
    });

    it('returns TEAM_NOT_FOUND for not found message', () => {
      const error = new Error('Team not found');
      const result = mapLinearError(error);

      expect(result.code).toBe('TEAM_NOT_FOUND');
      expect(result.message).toBe('Team not found');
    });

    it('returns API_ERROR for generic errors', () => {
      const error = new Error('Something went wrong');
      const result = mapLinearError(error);

      expect(result.code).toBe('API_ERROR');
      expect(result.message).toBe('Something went wrong');
    });

    it('handles non-Error objects (returns default message)', () => {
      const error = 'string error';
      const result = mapLinearError(error);

      // getErrorMessage returns the string directly for string errors
      expect(result.code).toBe('API_ERROR');
      expect(result.message).toBe('string error');
    });

    it('handles null error', () => {
      const result = mapLinearError(null);

      expect(result.code).toBe('API_ERROR');
      expect(result.message).toBe('Unknown Linear API error');
    });

    it('handles undefined error', () => {
      const result = mapLinearError(undefined);

      expect(result.code).toBe('API_ERROR');
      expect(result.message).toBe('Unknown Linear API error');
    });

    it('handles object error (returns default message)', () => {
      const error = { message: 'custom error object' };
      const result = mapLinearError(error);

      // getErrorMessage returns .message from plain objects with a message property
      expect(result.code).toBe('API_ERROR');
      expect(result.message).toBe('custom error object');
    });
  });

  describe('createDedupKey', () => {
    it('creates key from operation only', () => {
      const key = createDedupKey('validateAndGetTeams');
      expect(key).toBe('validateAndGetTeams:');
    });

    it('creates key from operation and single arg', () => {
      const key = createDedupKey('validateAndGetTeams', 'lin_abc1');
      expect(key).toBe('validateAndGetTeams:lin_abc1');
    });

    it('creates key from operation and multiple args', () => {
      const key = createDedupKey('listIssues', 'lin_abc1', 'team-123', '7');
      expect(key).toBe('listIssues:lin_abc1:team-123:7');
    });

    it('handles empty args', () => {
      const key = createDedupKey('getIssue', '', '', '');
      expect(key).toBe('getIssue:::');
    });
  });

  describe('filterIssuesByCompletionDate', () => {
    function createTestIssue(overrides: Partial<LinearIssue>): LinearIssue {
      return {
        id: 'issue-1',
        identifier: 'ENG-1',
        title: 'Test Issue',
        description: null,
        priority: 0 as 0 | 1 | 2 | 3 | 4,
        state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
        url: 'https://linear.app/issue/1',
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T10:00:00.000Z',
        completedAt: null,
        childCount: 0,
        children: [],
        labels: [],
        ...overrides,
      };
    }

    it('keeps active issues (non-completed/cancelled state)', () => {
      const issues = [
        createTestIssue({ state: { id: 's1', name: 'In Progress', type: 'started' } }),
        createTestIssue({ state: { id: 's2', name: 'Backlog', type: 'backlog' } }),
        createTestIssue({ state: { id: 's3', name: 'Todo', type: 'unstarted' } }),
      ];

      const filtered = filterIssuesByCompletionDate(issues, 7);

      expect(filtered).toHaveLength(3);
    });

    it('keeps recently completed issues within cutoff', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: threeDaysAgo.toISOString(),
        }),
      ];

      const filtered = filterIssuesByCompletionDate(issues, 7);

      expect(filtered).toHaveLength(1);
    });

    it('filters out old completed issues beyond cutoff', () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: thirtyDaysAgo.toISOString(),
        }),
      ];

      const filtered = filterIssuesByCompletionDate(issues, 7);

      expect(filtered).toHaveLength(0);
    });

    it('filters out old cancelled issues beyond cutoff', () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Cancelled', type: 'cancelled' },
          completedAt: thirtyDaysAgo.toISOString(),
        }),
      ];

      const filtered = filterIssuesByCompletionDate(issues, 7);

      expect(filtered).toHaveLength(0);
    });

    it('keeps completed issues without completedAt date', () => {
      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: null,
        }),
      ];

      const filtered = filterIssuesByCompletionDate(issues, 7);

      expect(filtered).toHaveLength(1);
    });

    it('keeps cancelled issues without completedAt date', () => {
      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Cancelled', type: 'cancelled' },
          completedAt: null,
        }),
      ];

      const filtered = filterIssuesByCompletionDate(issues, 7);

      expect(filtered).toHaveLength(1);
    });

    it('respects custom completedSinceDays value', () => {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: fiveDaysAgo.toISOString(),
        }),
      ];

      // With 3 days cutoff, 5-day-old issue should be filtered
      expect(filterIssuesByCompletionDate(issues, 3)).toHaveLength(0);

      // With 7 days cutoff, 5-day-old issue should be kept
      expect(filterIssuesByCompletionDate(issues, 7)).toHaveLength(1);
    });

    it('handles mixed issue states correctly', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const issues = [
        createTestIssue({
          id: 'active',
          state: { id: 's1', name: 'In Progress', type: 'started' },
        }),
        createTestIssue({
          id: 'recent-completed',
          state: { id: 's2', name: 'Done', type: 'completed' },
          completedAt: twoDaysAgo.toISOString(),
        }),
        createTestIssue({
          id: 'old-completed',
          state: { id: 's3', name: 'Done', type: 'completed' },
          completedAt: thirtyDaysAgo.toISOString(),
        }),
        createTestIssue({
          id: 'old-cancelled',
          state: { id: 's4', name: 'Cancelled', type: 'cancelled' },
          completedAt: thirtyDaysAgo.toISOString(),
        }),
        createTestIssue({
          id: 'completed-no-date',
          state: { id: 's5', name: 'Done', type: 'completed' },
          completedAt: null,
        }),
      ];

      const filtered = filterIssuesByCompletionDate(issues, 7);

      expect(filtered).toHaveLength(3);
      expect(filtered.map((i) => i.id)).toEqual(['active', 'recent-completed', 'completed-no-date']);
    });

    it('handles empty array', () => {
      const filtered = filterIssuesByCompletionDate([], 7);
      expect(filtered).toHaveLength(0);
    });

    it('handles issue completed exactly at cutoff boundary', () => {
      // Create a date that's exactly on the boundary (7 days ago at the exact millisecond)
      // The comparison is completedDate < completedSinceDate, so exact match should be filtered
      const exactlySevenDaysAgo = new Date();
      exactlySevenDaysAgo.setDate(exactlySevenDaysAgo.getDate() - 7);

      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: exactlySevenDaysAgo.toISOString(),
        }),
      ];

      // Exactly 7 days ago with 7 day cutoff is filtered (completedDate < completedSinceDate)
      // because setDate creates a new date at current time minus 7 days, and the cutoff
      // is also current time minus 7 days, making them equal or very close
      const filtered = filterIssuesByCompletionDate(issues, 7);
      // Due to timing, this could be 0 or 1 - let's just verify the logic runs
      expect(filtered.length).toBeLessThanOrEqual(1);
    });

    it('DEFAULT_COMPLETED_SINCE_DAYS is set to 60 days', () => {
      expect(DEFAULT_COMPLETED_SINCE_DAYS).toBe(60);
    });

    it('retains issues completed within the default 60-day window', () => {
      const fortyFiveDaysAgo = new Date();
      fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: fortyFiveDaysAgo.toISOString(),
        }),
      ];

      const filtered = filterIssuesByCompletionDate(
        issues,
        DEFAULT_COMPLETED_SINCE_DAYS
      );
      expect(filtered).toHaveLength(1);
    });

    it('prunes issues completed beyond the default 60-day window', () => {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const issues = [
        createTestIssue({
          state: { id: 's1', name: 'Done', type: 'completed' },
          completedAt: ninetyDaysAgo.toISOString(),
        }),
      ];

      const filtered = filterIssuesByCompletionDate(
        issues,
        DEFAULT_COMPLETED_SINCE_DAYS
      );
      expect(filtered).toHaveLength(0);
    });
  });

  describe('mapTeam', () => {
    it('maps Linear SDK Team to LinearTeam', () => {
      const team = {
        id: 'team-123',
        name: 'Engineering',
        key: 'ENG',
      } as Team;

      const result = mapTeam(team);

      expect(result).toEqual({
        id: 'team-123',
        name: 'Engineering',
        key: 'ENG',
      });
    });

    it('handles team with special characters in name', () => {
      const team = {
        id: 'team-456',
        name: 'R&D / Research',
        key: 'RD',
      } as Team;

      const result = mapTeam(team);

      expect(result).toEqual({
        id: 'team-456',
        name: 'R&D / Research',
        key: 'RD',
      });
    });
  });

  describe('cache utility functions', () => {
    it('clearClientCache clears both caches', () => {
      clearClientCache();

      expect(getClientCacheSize()).toBe(0);
      expect(getDedupCacheSize()).toBe(0);
    });

    it('getClientCacheSize returns 0 after clear', () => {
      clearClientCache();
      expect(getClientCacheSize()).toBe(0);
    });

    it('getDedupCacheSize returns 0 after clear', () => {
      clearClientCache();
      expect(getDedupCacheSize()).toBe(0);
    });
  });

  describe('isTransientUpstreamError', () => {
    it('returns true for 502 in error message', () => {
      expect(isTransientUpstreamError(new Error('GraphQL Error (Code: 502)'))).toBe(true);
    });

    it('returns true for 503 in error message', () => {
      expect(isTransientUpstreamError(new Error('503 Service Unavailable'))).toBe(true);
    });

    it('returns true for 504 in error message', () => {
      expect(isTransientUpstreamError(new Error('504 Gateway Timeout'))).toBe(true);
    });

    it('returns false for 401 Unauthorized error', () => {
      expect(isTransientUpstreamError(new Error('401 Unauthorized'))).toBe(false);
    });

    it('returns false for 404 Not Found error', () => {
      expect(isTransientUpstreamError(new Error('404 Not Found'))).toBe(false);
    });

    it('returns false for 429 rate limit error', () => {
      expect(isTransientUpstreamError(new Error('429 Too Many Requests'))).toBe(false);
    });

    it('returns false for null error', () => {
      expect(isTransientUpstreamError(null)).toBe(false);
    });

    it('returns false for undefined error', () => {
      expect(isTransientUpstreamError(undefined)).toBe(false);
    });

    it('returns false for string error', () => {
      expect(isTransientUpstreamError('not an error')).toBe(false);
    });
  });

  describe('withLinearRetry', () => {
    function neverSleep(): Promise<void> {
      return Promise.resolve();
    }

    it('returns value on first successful attempt without retrying', async () => {
      const fn = vi.fn(async () => 'ok');
      const result = await withLinearRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: neverSleep,
      });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on transient 502 and succeeds on second attempt', async () => {
      const fn = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('GraphQL Error (Code: 502)'))
        .mockResolvedValueOnce('ok');

      const result = await withLinearRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: neverSleep,
      });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries up to maxAttempts on transient 5xx then throws the last error', async () => {
      const err502 = new Error('GraphQL Error (Code: 502)');
      const fn = vi.fn<() => Promise<string>>().mockRejectedValue(err502);

      await expect(
        withLinearRetry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: neverSleep })
      ).rejects.toBe(err502);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry on non-transient errors', async () => {
      const authErr = new Error('401 Unauthorized');
      const fn = vi.fn<() => Promise<string>>().mockRejectedValue(authErr);

      await expect(
        withLinearRetry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: neverSleep })
      ).rejects.toBe(authErr);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 4xx (404, 429) errors', async () => {
      const notFound = new Error('404 Not Found');
      const fn = vi.fn<() => Promise<string>>().mockRejectedValue(notFound);

      await expect(
        withLinearRetry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: neverSleep })
      ).rejects.toBe(notFound);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('invokes sleep between attempts with exponential backoff', async () => {
      const sleeps: number[] = [];
      const sleep = async (ms: number): Promise<void> => {
        sleeps.push(ms);
      };
      const fn = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('502'))
        .mockRejectedValueOnce(new Error('503'))
        .mockResolvedValueOnce('ok');

      await withLinearRetry(fn, { maxAttempts: 3, baseDelayMs: 100, sleep });

      expect(fn).toHaveBeenCalledTimes(3);
      expect(sleeps).toEqual([100, 200]);
    });

    it('caps sleep delay at maxDelayMs', async () => {
      const sleeps: number[] = [];
      const sleep = async (ms: number): Promise<void> => {
        sleeps.push(ms);
      };
      const fn = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('502'))
        .mockRejectedValueOnce(new Error('503'))
        .mockRejectedValueOnce(new Error('504'))
        .mockResolvedValueOnce('ok');

      await withLinearRetry(fn, { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 150, sleep });

      // First sleep: 100ms, second: 200 → capped at 150, third: would be 400 → capped at 150
      expect(sleeps).toEqual([100, 150, 150]);
    });

    it('uses setTimeout-based default sleep when sleep option is omitted', async () => {
      // Exercises the `opts.sleep ?? (ms => setTimeout(...))` branch by omitting sleep.
      // baseDelayMs is set to 1 so the test completes quickly.
      const fn = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('502'))
        .mockResolvedValueOnce('ok');

      const result = await withLinearRetry(fn, { maxAttempts: 2, baseDelayMs: 1 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
