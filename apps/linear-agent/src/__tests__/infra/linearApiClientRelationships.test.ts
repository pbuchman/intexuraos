import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { LinearErrorType, type Issue } from '@linear/sdk';
import { clearClientCache, createLinearApiClient } from '../../infra/linear/linearApiClient.js';

const mocks = vi.hoisted(() => ({
  issues: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:timers/promises', () => ({ setTimeout: mocks.sleep }));
vi.mock('@linear/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@linear/sdk')>()),
  LinearClient: vi.fn(function LinearClient() {
    return { issues: mocks.issues };
  }),
}));
vi.mock('@intexuraos/infra-sentry', () => ({
  createAppLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: mocks.warn,
    error: mocks.error,
  })),
}));

const relationships = ['state', 'children', 'parent', 'labels', 'assignee'] as const;

function createSdkIssue(id: string): {
  reads: Record<(typeof relationships)[number], Mock>;
  issue: Partial<Issue>;
} {
  const reads = {
    state: vi.fn().mockResolvedValue({ id: 'state-1', name: 'In Progress', type: 'started' }),
    children: vi.fn().mockResolvedValue({ nodes: [{ id: 'child-1' }] }),
    parent: vi.fn().mockResolvedValue({ id: 'parent-1' }),
    labels: vi.fn().mockResolvedValue({
      nodes: [{ id: 'label-1', name: 'Bug', color: '#ff0000' }],
    }),
    assignee: vi.fn().mockResolvedValue({ id: 'assignee-1', name: 'Example User' }),
  };

  return {
    reads,
    issue: {
      id,
      identifier: 'ENG-123',
      title: 'Issue with relationships',
      description: 'Keep all relationship data during retries',
      priority: 2,
      url: 'https://linear.app/example/issue/ENG-123',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-15T00:00:00.000Z'),
      // SDK getters initiate a new request on every access.
      get state(): Issue['state'] { return reads.state(); },
      get parent(): Issue['parent'] { return reads.parent(); },
      get assignee(): Issue['assignee'] { return reads.assignee(); },
      children: reads.children,
      labels: reads.labels,
    },
  };
}

function unavailableError(): Error {
  return Object.assign(new Error('GraphQL Error (Code: 503) - private response body'), {
    type: LinearErrorType.NetworkError,
    status: 503,
  });
}

describe('listIssues relationship retries', () => {
  beforeEach(() => {
    clearClientCache();
    vi.clearAllMocks();
    mocks.issues.mockReset();
  });

  afterEach(() => {
    clearClientCache();
  });

  it.each(relationships)('recovers a transient %s failure without repeating successful reads', async (relationship) => {
    const failing = createSdkIssue('issue-retried');
    const healthy = createSdkIssue('issue-healthy');
    failing.reads[relationship].mockRejectedValueOnce(unavailableError());
    mocks.issues.mockResolvedValue({
      nodes: [failing.issue, healthy.issue],
      pageInfo: { hasNextPage: false },
    });

    const result = await createLinearApiClient().listIssues('api-key', 'team-1');

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          id: 'issue-retried',
          state: { id: 'state-1', name: 'In Progress', type: 'started' },
          childCount: 1,
          parentId: 'parent-1',
          labels: [{ id: 'label-1', name: 'Bug', color: '#ff0000' }],
          assignee: { id: 'assignee-1', name: 'Example User' },
        },
        { id: 'issue-healthy' },
      ],
    });
    expect(mocks.issues).toHaveBeenCalledTimes(1);
    for (const name of relationships) {
      expect(failing.reads[name]).toHaveBeenCalledTimes(name === relationship ? 2 : 1);
      expect(healthy.reads[name]).toHaveBeenCalledTimes(1);
    }
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        teamId: 'team-1',
        operationName: `listIssues.${relationship}`,
        attempt: 1,
        error: 'Linear listIssues.mapIssuesWithBatchedStates failed: NetworkError (HTTP 503)',
        _skipSentry: true,
      }),
      'Linear listIssues transient failure, retrying'
    );
    expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(expect.any(Number));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('private response body');
  });

  it.each(relationships)('preserves the final %s failure and diagnostics after three attempts', async (relationship) => {
    const failing = createSdkIssue('issue-failing');
    failing.reads[relationship].mockRejectedValue(unavailableError());
    mocks.issues.mockResolvedValue({ nodes: [failing.issue], pageInfo: { hasNextPage: false } });

    const result = await createLinearApiClient().listIssues('api-key', 'team-1');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Linear API temporarily unavailable',
        diagnostics: {
          operation: 'listIssues.mapIssuesWithBatchedStates',
          message: 'Linear listIssues.mapIssuesWithBatchedStates failed: NetworkError (HTTP 503)',
          statusCode: 503,
        },
      },
    });
    expect(failing.reads[relationship]).toHaveBeenCalledTimes(3);
    expect(mocks.issues).toHaveBeenCalledTimes(1);
    expect(mocks.sleep).toHaveBeenCalledTimes(2);
    expect(mocks.sleep.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(500);
    expect(mocks.sleep.mock.calls[0]?.[0]).toBeLessThanOrEqual(625);
    expect(mocks.sleep.mock.calls[1]?.[0]).toBeGreaterThanOrEqual(1000);
    expect(mocks.sleep.mock.calls[1]?.[0]).toBeLessThanOrEqual(1250);
  });

  it.each([
    ['401 Unauthorized', 'INVALID_API_KEY'],
    ['404 not found', 'TEAM_NOT_FOUND'],
    ['429 rate limit', 'RATE_LIMIT'],
  ])('returns permanent relationship failure %s immediately', async (message, code) => {
    const failing = createSdkIssue('issue-failing');
    failing.reads.state.mockRejectedValue(new Error(message));
    mocks.issues.mockResolvedValue({ nodes: [failing.issue], pageInfo: { hasNextPage: false } });

    const result = await createLinearApiClient().listIssues('api-key', 'team-1');

    expect(result).toMatchObject({
      ok: false,
      error: { code, diagnostics: { operation: 'listIssues.mapIssuesWithBatchedStates' } },
    });
    expect(failing.reads.state).toHaveBeenCalledTimes(1);
    expect(mocks.sleep).not.toHaveBeenCalled();
  });

  it('keeps absent optional relationships empty', async () => {
    const issue = createSdkIssue('issue-no-relations');
    issue.reads.parent.mockReturnValue(undefined);
    issue.reads.assignee.mockReturnValue(undefined);
    issue.reads.children.mockResolvedValue({ nodes: [] });
    issue.reads.labels.mockResolvedValue({ nodes: [] });
    mocks.issues.mockResolvedValue({ nodes: [issue.issue], pageInfo: { hasNextPage: false } });

    const result = await createLinearApiClient().listIssues('api-key', 'team-1');

    expect(result).toMatchObject({
      ok: true,
      value: [{ parentId: null, assignee: null, childCount: 0, labels: [] }],
    });
    expect(mocks.sleep).not.toHaveBeenCalled();
  });
});
