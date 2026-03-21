/**
 * Tests for issueGrouper.ts
 */
import { describe, expect, it } from 'vitest';
import type { LinearIssue } from '../../domain/models.js';
import { groupIssuesByDashboardColumn, DONE_RECENT_DAYS } from '../../domain/issueGrouper.js';

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  const now = new Date().toISOString();
  return {
    id: `issue-${Math.random().toString(36).slice(2)}`,
    identifier: 'ENG-001',
    title: 'Test Issue',
    description: null,
    priority: 0,
    state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
    url: 'https://linear.app/issue/test',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    childCount: 0,
    children: [],
    labels: [],
    ...overrides,
  };
}

describe('groupIssuesByDashboardColumn', () => {
  describe('grouping by state type', () => {
    it('groups backlog issues', () => {
      const issue = makeIssue({
        id: 'issue-1',
        title: 'Backlog Issue',
        state: { id: 's1', name: 'Backlog', type: 'backlog' },
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.backlog).toHaveLength(1);
      expect(result.backlog[0]?.title).toBe('Backlog Issue');
    });

    it('groups started issues as in_progress', () => {
      const issue = makeIssue({
        id: 'issue-1',
        title: 'In Progress Issue',
        state: { id: 's1', name: 'In Progress', type: 'started' },
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.in_progress).toHaveLength(1);
      expect(result.in_progress[0]?.title).toBe('In Progress Issue');
    });

    it('groups completed issues as done', () => {
      const today = new Date();
      const issue = makeIssue({
        id: 'issue-1',
        title: 'Completed Issue',
        state: { id: 's1', name: 'Done', type: 'completed' },
        completedAt: today.toISOString(),
        updatedAt: today.toISOString(),
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.done).toHaveLength(1);
      expect(result.done[0]?.title).toBe('Completed Issue');
    });

    it('groups cancelled issues as done', () => {
      const issue = makeIssue({
        id: 'issue-1',
        title: 'Cancelled Issue',
        state: { id: 's1', name: 'Cancelled', type: 'cancelled' },
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.done).toHaveLength(1);
    });

    it('groups issues with "review" in name as in_review', () => {
      const issue = makeIssue({
        id: 'issue-1',
        title: 'In Review Issue',
        state: { id: 's1', name: 'In Review', type: 'started' },
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.in_review).toHaveLength(1);
    });

    it('groups issues with "test" in name as to_test', () => {
      const issue = makeIssue({
        id: 'issue-1',
        title: 'Testing Issue',
        state: { id: 's1', name: 'QA', type: 'started' },
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.to_test).toHaveLength(1);
    });
  });

  describe('done vs archive split by date', () => {
    it('puts recent completed issues in done column', () => {
      const today = new Date();
      const issue = makeIssue({
        id: 'issue-1',
        title: 'Recently Completed',
        state: { id: 's1', name: 'Done', type: 'completed' },
        completedAt: today.toISOString(),
        updatedAt: today.toISOString(),
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.done).toHaveLength(1);
      expect(result.archive).toHaveLength(0);
    });

    it('puts old completed issues in archive column', () => {
      const today = new Date();
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(today.getDate() - 10);

      const issue = makeIssue({
        id: 'issue-1',
        title: 'Old Completed',
        state: { id: 's1', name: 'Done', type: 'completed' },
        completedAt: tenDaysAgo.toISOString(),
        updatedAt: tenDaysAgo.toISOString(),
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.done).toHaveLength(0);
      expect(result.archive).toHaveLength(1);
      expect(result.archive[0]?.title).toBe('Old Completed');
    });

    it('uses updatedAt when completedAt is null for done issues', () => {
      const today = new Date();
      const recentDate = new Date(today);
      recentDate.setDate(today.getDate() - 3); // Within DONE_RECENT_DAYS

      const issue = makeIssue({
        id: 'issue-1',
        title: 'Done without completedAt',
        state: { id: 's1', name: 'Done', type: 'completed' },
        completedAt: null,
        updatedAt: recentDate.toISOString(),
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.done).toHaveLength(1);
      expect(result.archive).toHaveLength(0);
    });

    it('uses updatedAt when completedAt is old for done issues', () => {
      const today = new Date();
      const oldDate = new Date(today);
      oldDate.setDate(today.getDate() - 10); // Outside DONE_RECENT_DAYS

      const issue = makeIssue({
        id: 'issue-1',
        title: 'Done with old updatedAt',
        state: { id: 's1', name: 'Done', type: 'completed' },
        completedAt: null,
        updatedAt: oldDate.toISOString(),
      });

      const result = groupIssuesByDashboardColumn([issue], { includeArchive: true });

      expect(result.done).toHaveLength(0);
      expect(result.archive).toHaveLength(1);
    });
  });

  describe('includeArchive option', () => {
    it('excludes old done items when includeArchive=false', () => {
      const today = new Date();
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(today.getDate() - 10);

      const oldDone = makeIssue({
        id: 'issue-1',
        title: 'Old Done',
        state: { id: 's1', name: 'Done', type: 'completed' },
        completedAt: tenDaysAgo.toISOString(),
        updatedAt: tenDaysAgo.toISOString(),
      });

      const result = groupIssuesByDashboardColumn([oldDone], { includeArchive: false });

      expect(result.done).toHaveLength(0);
      expect(result.archive).toHaveLength(0);
    });

    it('includes old done items when includeArchive=true', () => {
      const today = new Date();
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(today.getDate() - 10);

      const oldDone = makeIssue({
        id: 'issue-1',
        title: 'Old Done',
        state: { id: 's1', name: 'Done', type: 'completed' },
        completedAt: tenDaysAgo.toISOString(),
        updatedAt: tenDaysAgo.toISOString(),
      });

      const result = groupIssuesByDashboardColumn([oldDone], { includeArchive: true });

      expect(result.archive).toHaveLength(1);
    });
  });

  describe('sorting', () => {
    it('sorts each column by updatedAt descending', () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(today.getDate() - 2);

      const issues = [
        makeIssue({
          id: 'issue-1',
          title: 'Oldest',
          state: { id: 's1', name: 'Backlog', type: 'backlog' },
          updatedAt: twoDaysAgo.toISOString(),
        }),
        makeIssue({
          id: 'issue-2',
          title: 'Newest',
          state: { id: 's1', name: 'Backlog', type: 'backlog' },
          updatedAt: today.toISOString(),
        }),
        makeIssue({
          id: 'issue-3',
          title: 'Middle',
          state: { id: 's1', name: 'Backlog', type: 'backlog' },
          updatedAt: yesterday.toISOString(),
        }),
      ];

      const result = groupIssuesByDashboardColumn(issues, { includeArchive: true });

      expect(result.backlog[0]?.title).toBe('Newest');
      expect(result.backlog[1]?.title).toBe('Middle');
      expect(result.backlog[2]?.title).toBe('Oldest');
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const result = groupIssuesByDashboardColumn([], { includeArchive: true });

      expect(result.todo).toHaveLength(0);
      expect(result.backlog).toHaveLength(0);
      expect(result.in_progress).toHaveLength(0);
      expect(result.in_review).toHaveLength(0);
      expect(result.to_test).toHaveLength(0);
      expect(result.done).toHaveLength(0);
      expect(result.archive).toHaveLength(0);
    });

    it('uses custom doneDays option', () => {
      const today = new Date();
      const fiveDaysAgo = new Date(today);
      fiveDaysAgo.setDate(today.getDate() - 5);

      const issue = makeIssue({
        id: 'issue-1',
        title: 'Done 5 days ago',
        state: { id: 's1', name: 'Done', type: 'completed' },
        completedAt: fiveDaysAgo.toISOString(),
        updatedAt: fiveDaysAgo.toISOString(),
      });

      // With default 7 days, this should be in done
      const resultDefault = groupIssuesByDashboardColumn([issue], {
        includeArchive: true,
        doneDays: 7,
      });
      expect(resultDefault.done).toHaveLength(1);
      expect(resultDefault.archive).toHaveLength(0);

      // With 3 days, this should be in archive
      const resultCustom = groupIssuesByDashboardColumn([issue], {
        includeArchive: true,
        doneDays: 3,
      });
      expect(resultCustom.done).toHaveLength(0);
      expect(resultCustom.archive).toHaveLength(1);
    });
  });
});

describe('DONE_RECENT_DAYS constant', () => {
  it('equals 7', () => {
    expect(DONE_RECENT_DAYS).toBe(7);
  });
});
