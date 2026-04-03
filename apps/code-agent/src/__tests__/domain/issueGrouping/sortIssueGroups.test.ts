import { describe, expect, it } from 'vitest';

import type { IssueGroup, PipelineState, SerializedTask } from '../../../domain/issueGrouping/index.js';
import { parseLinearIssueNumber, sortIssueGroups, comparePrNumber, compareDispatched } from '../../../domain/issueGrouping/index.js';

function makeTask(overrides: Partial<SerializedTask> & { id: string }): SerializedTask {
  return {
    userId: 'test-user',
    prompt: 'test',
    sanitizedPrompt: 'test',
    systemPromptHash: 'hash',
    workerType: 'auto',
    workerLocation: 'test',
    repository: 'owner/repo',
    baseBranch: 'main',
    traceId: 'trace-1',
    dedupKey: 'dedup',
    callbackReceived: false,
    status: 'implemented',
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<IssueGroup>): IssueGroup {
  const defaultTask = makeTask({ id: 'task-1' });
  return {
    linearIssueId: null,
    linearIssue: undefined,
    tasks: [defaultTask],
    pipeline: { steps: [], pr: null, failedAttempts: 0, archivedCount: 0 },
    latestTask: defaultTask,
    aggregateStatus: 'done',
    ...overrides,
  };
}

describe('parseLinearIssueNumber', () => {
  it('parses INT-445 to 445', () => {
    expect(parseLinearIssueNumber('INT-445')).toBe(445);
  });

  it('parses INT-1 to 1', () => {
    expect(parseLinearIssueNumber('INT-1')).toBe(1);
  });

  it('returns null for invalid string', () => {
    expect(parseLinearIssueNumber('invalid')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseLinearIssueNumber('')).toBeNull();
  });

  it('parses other prefixes like PROJ-123', () => {
    expect(parseLinearIssueNumber('PROJ-123')).toBe(123);
  });
});

describe('sortIssueGroups', () => {
  describe('sort by linear-id', () => {
    it('sorts higher issue numbers first', () => {
      const groups = [
        makeGroup({ linearIssueId: 'INT-100', latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ linearIssueId: 'INT-500', latestTask: makeTask({ id: 't2', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ linearIssueId: 'INT-200', latestTask: makeTask({ id: 't3', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'linear-id');

      expect(sorted[0]?.linearIssueId).toBe('INT-500');
      expect(sorted[1]?.linearIssueId).toBe('INT-200');
      expect(sorted[2]?.linearIssueId).toBe('INT-100');
    });

    it('sorts standalone groups before linked groups', () => {
      const groups = [
        makeGroup({ linearIssueId: 'INT-100', latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ linearIssueId: null, latestTask: makeTask({ id: 't2', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'linear-id');

      expect(sorted[0]?.linearIssueId).toBeNull();
      expect(sorted[1]?.linearIssueId).toBe('INT-100');
    });

    it('sorts standalone groups by updatedAt desc', () => {
      const groups = [
        makeGroup({ linearIssueId: null, latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ linearIssueId: null, latestTask: makeTask({ id: 't2', updatedAt: '2026-03-05T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'linear-id');

      expect(sorted[0]?.latestTask.id).toBe('t2');
      expect(sorted[1]?.latestTask.id).toBe('t1');
    });

    it('breaks ties on same issue number by updatedAt desc', () => {
      const groups = [
        makeGroup({ linearIssueId: 'INT-100', latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ linearIssueId: 'INT-100', latestTask: makeTask({ id: 't2', updatedAt: '2026-03-05T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'linear-id');

      expect(sorted[0]?.latestTask.id).toBe('t2');
      expect(sorted[1]?.latestTask.id).toBe('t1');
    });
  });

  describe('sort by pr-number', () => {
    it('sorts groups with PRs first, higher PR numbers first', () => {
      const prPipeline = (num: string): PipelineState => ({
        steps: [],
        pr: { url: `https://github.com/owner/repo/pull/${num}`, number: num },
        failedAttempts: 0,
        archivedCount: 0,
      });

      const noPrPipeline: PipelineState = { steps: [], pr: null, failedAttempts: 0, archivedCount: 0 };

      const groups = [
        makeGroup({ pipeline: noPrPipeline, latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ pipeline: prPipeline('10'), latestTask: makeTask({ id: 't2', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ pipeline: prPipeline('50'), latestTask: makeTask({ id: 't3', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'pr-number');

      expect(sorted[0]?.pipeline.pr?.number).toBe('50');
      expect(sorted[1]?.pipeline.pr?.number).toBe('10');
      expect(sorted[2]?.pipeline.pr).toBeNull();
    });

    it('falls back to updatedAt desc when neither has PR', () => {
      const noPr: PipelineState = { steps: [], pr: null, failedAttempts: 0, archivedCount: 0 };

      const groups = [
        makeGroup({ pipeline: noPr, latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ pipeline: noPr, latestTask: makeTask({ id: 't2', updatedAt: '2026-03-05T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'pr-number');

      expect(sorted[0]?.latestTask.id).toBe('t2');
      expect(sorted[1]?.latestTask.id).toBe('t1');
    });
  });

  describe('sort by last-updated', () => {
    it('sorts by latestTask.updatedAt desc', () => {
      const groups = [
        makeGroup({ latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ latestTask: makeTask({ id: 't2', updatedAt: '2026-03-10T10:00:00.000Z' }) }),
        makeGroup({ latestTask: makeTask({ id: 't3', updatedAt: '2026-03-05T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'last-updated');

      expect(sorted[0]?.latestTask.id).toBe('t2');
      expect(sorted[1]?.latestTask.id).toBe('t3');
      expect(sorted[2]?.latestTask.id).toBe('t1');
    });
  });

  describe('sort by dispatched', () => {
    it('sorts groups with dispatchedAt first, then by createdAt', () => {
      const groups = [
        makeGroup({
          latestTask: makeTask({ id: 't1', createdAt: '2026-03-10T10:00:00.000Z' }),
        }),
        makeGroup({
          mostRecentDispatchedAt: '2026-03-02T10:00:00.000Z',
          latestTask: makeTask({ id: 't2', createdAt: '2026-03-01T10:00:00.000Z' }),
        }),
        makeGroup({
          mostRecentDispatchedAt: '2026-03-05T10:00:00.000Z',
          latestTask: makeTask({ id: 't3', createdAt: '2026-03-01T10:00:00.000Z' }),
        }),
      ];

      const sorted = sortIssueGroups(groups, 'dispatched');

      expect(sorted[0]?.latestTask.id).toBe('t3');
      expect(sorted[1]?.latestTask.id).toBe('t2');
      expect(sorted[2]?.latestTask.id).toBe('t1');
    });

    it('falls back to createdAt desc when neither has dispatchedAt', () => {
      const groups = [
        makeGroup({ latestTask: makeTask({ id: 't1', createdAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ latestTask: makeTask({ id: 't2', createdAt: '2026-03-05T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'dispatched');

      expect(sorted[0]?.latestTask.id).toBe('t2');
      expect(sorted[1]?.latestTask.id).toBe('t1');
    });
  });

  describe('sort by dispatched (additional branches)', () => {
    it('exercises both aDispatched and bDispatched branches with 3 groups', () => {
      // With 3 groups (2 with dispatchedAt, 1 without), the sort comparator
      // ensures both `aDispatched !== undefined` and `bDispatched !== undefined` branches are hit.
      const groups = [
        makeGroup({
          latestTask: makeTask({ id: 't-none', createdAt: '2026-03-01T10:00:00.000Z' }),
        }),
        makeGroup({
          mostRecentDispatchedAt: '2026-03-02T10:00:00.000Z',
          latestTask: makeTask({ id: 't-early', createdAt: '2026-03-01T10:00:00.000Z' }),
        }),
        makeGroup({
          mostRecentDispatchedAt: '2026-03-05T10:00:00.000Z',
          latestTask: makeTask({ id: 't-late', createdAt: '2026-03-01T10:00:00.000Z' }),
        }),
      ];

      const sorted = sortIssueGroups(groups, 'dispatched');

      expect(sorted[0]?.latestTask.id).toBe('t-late');
      expect(sorted[1]?.latestTask.id).toBe('t-early');
      expect(sorted[2]?.latestTask.id).toBe('t-none');
    });
  });

  describe('sort by linear-id (additional branches)', () => {
    it('exercises both aNum-null and bNum-null branches with 3 groups', () => {
      // With 3 groups, the sort comparator is called multiple times,
      // ensuring both `aNum === null` and `bNum === null` branches are hit.
      const groups = [
        makeGroup({ linearIssueId: null, latestTask: makeTask({ id: 't-standalone', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ linearIssueId: 'INT-200', latestTask: makeTask({ id: 't-200', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ linearIssueId: 'INT-100', latestTask: makeTask({ id: 't-100', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'linear-id');

      // standalone first, then INT-200, then INT-100
      expect(sorted[0]?.linearIssueId).toBeNull();
      expect(sorted[1]?.linearIssueId).toBe('INT-200');
      expect(sorted[2]?.linearIssueId).toBe('INT-100');
    });
  });

  describe('sort by pr-number (additional branches)', () => {
    it('exercises both aNum-not-null and bNum-not-null branches with 3 groups', () => {
      // With 3 groups (2 with PR, 1 without), the sort comparator is called
      // multiple times ensuring both `aNum !== null` and `bNum !== null` branches are hit.
      const prPipeline = (num: string): PipelineState => ({
        steps: [],
        pr: { url: `https://github.com/owner/repo/pull/${num}`, number: num },
        failedAttempts: 0,
        archivedCount: 0,
      });
      const noPrPipeline: PipelineState = { steps: [], pr: null, failedAttempts: 0, archivedCount: 0 };

      const groups = [
        makeGroup({ pipeline: noPrPipeline, latestTask: makeTask({ id: 't-noPR', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ pipeline: prPipeline('10'), latestTask: makeTask({ id: 't-pr10', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ pipeline: prPipeline('50'), latestTask: makeTask({ id: 't-pr50', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'pr-number');

      expect(sorted[0]?.latestTask.id).toBe('t-pr50');
      expect(sorted[1]?.latestTask.id).toBe('t-pr10');
      expect(sorted[2]?.latestTask.id).toBe('t-noPR');
    });
  });

  describe('sort by pr-number (all comparator branches)', () => {
    it('exercises bNum-only branch when first element has no PR', () => {
      const prPipeline = (num: string): PipelineState => ({
        steps: [],
        pr: { url: `https://github.com/owner/repo/pull/${num}`, number: num },
        failedAttempts: 0,
        archivedCount: 0,
      });
      const noPrPipeline: PipelineState = { steps: [], pr: null, failedAttempts: 0, archivedCount: 0 };

      // 3 elements: [noPR-1, noPR-2, withPR] — the sort comparator will be called with
      // various pairs, ensuring both (a=noPR, b=withPR) and (a=noPR, b=noPR) are hit.
      const groups = [
        makeGroup({ pipeline: noPrPipeline, latestTask: makeTask({ id: 't-noPR-1', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
        makeGroup({ pipeline: noPrPipeline, latestTask: makeTask({ id: 't-noPR-2', updatedAt: '2026-03-05T10:00:00.000Z' }) }),
        makeGroup({ pipeline: prPipeline('42'), latestTask: makeTask({ id: 't-pr42', updatedAt: '2026-03-01T10:00:00.000Z' }) }),
      ];

      const sorted = sortIssueGroups(groups, 'pr-number');

      // PR group first, then noPR groups sorted by updatedAt desc
      expect(sorted[0]?.latestTask.id).toBe('t-pr42');
      expect(sorted[1]?.latestTask.id).toBe('t-noPR-2');
      expect(sorted[2]?.latestTask.id).toBe('t-noPR-1');
    });
  });

  describe('sort by dispatched (all comparator branches)', () => {
    it('exercises bDispatched-only branch when first element has no dispatch', () => {
      // 3 elements: [noDispatch-1, noDispatch-2, withDispatch] — ensures both
      // (a=noDispatch, b=withDispatch) and (a=noDispatch, b=noDispatch) are hit.
      const groups = [
        makeGroup({
          latestTask: makeTask({ id: 't-none-1', createdAt: '2026-03-01T10:00:00.000Z' }),
        }),
        makeGroup({
          latestTask: makeTask({ id: 't-none-2', createdAt: '2026-03-10T10:00:00.000Z' }),
        }),
        makeGroup({
          mostRecentDispatchedAt: '2026-03-05T10:00:00.000Z',
          latestTask: makeTask({ id: 't-dispatched', createdAt: '2026-03-01T10:00:00.000Z' }),
        }),
      ];

      const sorted = sortIssueGroups(groups, 'dispatched');

      // Dispatched group first, then noDispatch groups sorted by createdAt desc
      expect(sorted[0]?.latestTask.id).toBe('t-dispatched');
      expect(sorted[1]?.latestTask.id).toBe('t-none-2');
      expect(sorted[2]?.latestTask.id).toBe('t-none-1');
    });
  });

  it('does not mutate the original array', () => {
    const groups = [
      makeGroup({ linearIssueId: 'INT-100', latestTask: makeTask({ id: 't1' }) }),
      makeGroup({ linearIssueId: 'INT-200', latestTask: makeTask({ id: 't2' }) }),
    ];

    const sorted = sortIssueGroups(groups, 'linear-id');

    expect(sorted).not.toBe(groups);
    expect(groups[0]?.linearIssueId).toBe('INT-100');
  });
});

describe('comparePrNumber (direct comparator)', () => {
  const prPipeline = (num: string): PipelineState => ({
    steps: [],
    pr: { url: `https://github.com/owner/repo/pull/${num}`, number: num },
    failedAttempts: 0,
    archivedCount: 0,
  });
  const noPrPipeline: PipelineState = { steps: [], pr: null, failedAttempts: 0, archivedCount: 0 };

  it('returns negative when both have PRs and b is higher', () => {
    const a = makeGroup({ pipeline: prPipeline('10') });
    const b = makeGroup({ pipeline: prPipeline('50') });
    expect(comparePrNumber(a, b)).toBeGreaterThan(0);
  });

  it('returns -1 when only a has PR', () => {
    const a = makeGroup({ pipeline: prPipeline('10') });
    const b = makeGroup({ pipeline: noPrPipeline });
    expect(comparePrNumber(a, b)).toBe(-1);
  });

  it('returns 1 when only b has PR', () => {
    const a = makeGroup({ pipeline: noPrPipeline, latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) });
    const b = makeGroup({ pipeline: prPipeline('10'), latestTask: makeTask({ id: 't2', updatedAt: '2026-03-01T10:00:00.000Z' }) });
    expect(comparePrNumber(a, b)).toBe(1);
  });

  it('falls back to updatedAt when neither has PR', () => {
    const a = makeGroup({ pipeline: noPrPipeline, latestTask: makeTask({ id: 't1', updatedAt: '2026-03-01T10:00:00.000Z' }) });
    const b = makeGroup({ pipeline: noPrPipeline, latestTask: makeTask({ id: 't2', updatedAt: '2026-03-05T10:00:00.000Z' }) });
    expect(comparePrNumber(a, b)).toBeGreaterThan(0);
  });
});

describe('compareDispatched (direct comparator)', () => {
  it('sorts by dispatchedAt desc when both have it', () => {
    const a = makeGroup({ mostRecentDispatchedAt: '2026-03-01T10:00:00.000Z' });
    const b = makeGroup({ mostRecentDispatchedAt: '2026-03-05T10:00:00.000Z' });
    expect(compareDispatched(a, b)).toBeGreaterThan(0);
  });

  it('returns -1 when only a has dispatchedAt', () => {
    const a = makeGroup({ mostRecentDispatchedAt: '2026-03-01T10:00:00.000Z' });
    const b = makeGroup({});
    expect(compareDispatched(a, b)).toBe(-1);
  });

  it('returns 1 when only b has dispatchedAt', () => {
    const a = makeGroup({ latestTask: makeTask({ id: 't1', createdAt: '2026-03-01T10:00:00.000Z' }) });
    const b = makeGroup({ mostRecentDispatchedAt: '2026-03-05T10:00:00.000Z', latestTask: makeTask({ id: 't2', createdAt: '2026-03-01T10:00:00.000Z' }) });
    expect(compareDispatched(a, b)).toBe(1);
  });

  it('falls back to createdAt when neither has dispatchedAt', () => {
    const a = makeGroup({ latestTask: makeTask({ id: 't1', createdAt: '2026-03-01T10:00:00.000Z' }) });
    const b = makeGroup({ latestTask: makeTask({ id: 't2', createdAt: '2026-03-05T10:00:00.000Z' }) });
    expect(compareDispatched(a, b)).toBeGreaterThan(0);
  });
});
