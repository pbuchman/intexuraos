/**
 * Tests for GitHubEventLogTableRow.
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubEventLogTableRow } from '../GitHubEventLogTableRow.js';

const mockGetAccessToken = vi.fn();
const mockGetGitHubEventLogPayload = vi.fn();

vi.mock('@/context/index.js', () => ({
  useAuth: (): {
    getAccessToken: typeof mockGetAccessToken;
  } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services/codeAgentApi.js', () => ({
  getGitHubEventLogPayload: (...args: unknown[]): unknown => mockGetGitHubEventLogPayload(...args),
}));

function createRow(): React.ComponentProps<typeof GitHubEventLogTableRow>['row'] {
  return {
    id: 'delivery-1',
    decisionId: 'decision-1',
    normalizedEventId: 'normalized-1',
    deliveryId: 'delivery-1',
    githubEventName: 'pull_request',
    eventType: 'pull_request',
    action: 'opened',
    repository: 'intexuraos/test-repo',
    repositoryId: 101,
    pullRequestNumber: 42,
    pullRequestId: 4200,
    senderLogin: 'octocat',
    senderType: 'User',
    authPassedAt: '2026-03-12T10:00:00.000Z',
    updatedAt: '2026-03-12T10:00:00.000Z',
    decisionState: 'completed',
    decisionOutcome: 'request_review',
    decidedBy: 'github_agent',
    reason: 'LLM request_review: code_quality, test_quality',
    dispatchAction: 'create_review_task',
    reviewTypes: ['code_quality', 'test_quality'],
    taskId: 'task-review-1',
    workerType: 'qwen3.5-plus',
    decisionLatencyMs: 500,
    isHydrating: false,
  };
}

describe('GitHubEventLogTableRow', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders compact review badge text with separate review detail', () => {
    const { container } = render(<GitHubEventLogTableRow row={createRow()} />);

    expect(screen.getAllByText('Review')).toHaveLength(2);
    expect(screen.getAllByText('code_quality, test_quality')).toHaveLength(2);

    const detail = screen.getAllByTitle('code_quality, test_quality');
    expect(detail).toHaveLength(2);

    const desktopRow = container.querySelector<HTMLElement>('.xl\\:grid');
    if (desktopRow === null) throw new Error('desktop grid row not found');
    expect(desktopRow.className).toContain('hidden');
    expect(desktopRow.className).toContain('xl:grid');
    expect(desktopRow.className).not.toContain('lg:grid');
  });

  it('renders Pending badge when decisionState is pending', () => {
    const row = createRow();
    row.decisionState = 'pending';
    row.decisionOutcome = null;
    row.dispatchAction = null;
    row.reviewTypes = [];
    render(<GitHubEventLogTableRow row={row} />);

    expect(screen.getAllByText('Pending')).toHaveLength(2);
    expect(screen.queryByTitle('code_quality, test_quality')).toBeNull();
  });

  it('renders Dispatch badge when decisionOutcome is dispatch', () => {
    const row = createRow();
    row.decisionOutcome = 'dispatch';
    row.dispatchAction = 'create_task';
    row.reviewTypes = [];
    render(<GitHubEventLogTableRow row={row} />);

    expect(screen.getAllByText('Dispatch')).toHaveLength(2);
    expect(screen.queryByTitle('code_quality, test_quality')).toBeNull();
  });

  it('renders Skip badge when decisionOutcome is skip', () => {
    const row = createRow();
    row.decisionOutcome = 'skip';
    row.dispatchAction = null;
    row.reviewTypes = [];
    render(<GitHubEventLogTableRow row={row} />);

    expect(screen.getAllByText('Skip')).toHaveLength(2);
  });

  it('renders Completed badge as fallthrough', () => {
    const row = createRow();
    row.decisionOutcome = null;
    row.dispatchAction = null;
    row.reviewTypes = [];
    render(<GitHubEventLogTableRow row={row} />);

    expect(screen.getAllByText('Completed')).toHaveLength(2);
  });
});
