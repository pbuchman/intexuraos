/**
 * Tests for IssueTimeline.
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueTimeline } from '../code-tasks/IssueTimeline.js';
import type { CodeTask } from '@/types';

describe('IssueTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T14:35:00.000Z'));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders a Merge Conflict follow-up chip', () => {
    const task = {
      id: 'task-merge-conflict',
      userId: 'user-1',
      prompt: 'Resolve merge conflicts',
      sanitizedPrompt: 'Resolve merge conflicts',
      systemPromptHash: 'pr-merge-conflict-auto',
      workerType: 'auto',
      workerLocation: 'queued',
      repository: 'test/repo',
      baseBranch: 'main',
      traceId: 'trace-1',
      status: 'queued',
      dedupKey: 'dedup-key',
      callbackReceived: false,
      createdAt: '2026-03-28T10:00:00.000Z',
      statusChangedAt: '2026-03-28T10:00:00.000Z',
      updatedAt: '2026-03-28T10:00:00.000Z',
      agentType: 'pull_request',
      followUpReason: 'merge_conflict',
    } as CodeTask;

    render(React.createElement(IssueTimeline, { tasks: [task], onCollapse: vi.fn() }));

    expect(screen.getByText('Merge Conflict')).toBeTruthy();
  });

  it.each([
    ['failed', 'Failed', '2026-07-27T14:28:15.885Z', '2m 0s'],
    ['reviewed', 'Reviewed', '2026-07-27T14:28:15.885Z', '2m 0s'],
    ['archived', 'Archived', '2026-07-28T09:00:00.000Z', '2m 0s'],
  ] as const)('shows %s lifecycle time while duration stops at preserved completion', (status, verb, statusChangedAt, duration) => {
    const task = {
      id: `task-${status}`,
      userId: 'user-1',
      prompt: 'Task prompt',
      sanitizedPrompt: 'Task prompt',
      systemPromptHash: 'hash-1',
      workerType: 'codex',
      workerLocation: 'home-dev',
      repository: 'test/repo',
      baseBranch: 'development',
      traceId: 'trace-1',
      status,
      dedupKey: 'dedup-1',
      callbackReceived: false,
      createdAt: '2026-07-27T14:20:00.000Z',
      dispatchedAt: '2026-07-27T14:26:15.885Z',
      statusChangedAt,
      completedAt: '2026-07-27T14:28:15.885Z',
      updatedAt: '2026-07-28T11:00:00.000Z',
    } as CodeTask;

    render(React.createElement(IssueTimeline, { tasks: [task], onCollapse: vi.fn() }));

    expect(
      screen.getByText(new RegExp(`${verb} .*${status === 'archived' ? 'Jul 28' : 'Jul 27'}`))
    ).toBeTruthy();
    expect(screen.getByText(duration)).toBeTruthy();
    expect(document.querySelector('time[datetime="2026-07-28T11:00:00.000Z"]')).toBeNull();
  });

  it('shows Never started and renders PR, summary, and failure independently', () => {
    const task = {
      id: 'task-auth-failure',
      userId: 'user-1',
      prompt: 'Task prompt',
      sanitizedPrompt: 'Task prompt',
      systemPromptHash: 'hash-1',
      workerType: 'codex-xhigh',
      workerLocation: 'home-dev',
      repository: 'test/repo',
      baseBranch: 'development',
      traceId: 'trace-1',
      status: 'failed',
      dedupKey: 'dedup-1',
      callbackReceived: false,
      createdAt: '2026-07-27T14:20:00.000Z',
      statusChangedAt: '2026-07-27T14:28:15.885Z',
      completedAt: '2026-07-27T14:28:15.885Z',
      updatedAt: '2026-07-27T15:35:09.634Z',
      result: {
        summary: 'A summary remains visible',
        prUrl: 'https://github.com/test/repo/pull/42',
      },
      error: {
        code: 'codex_auth_unavailable',
        message: 'No reachable worker has active Codex auth.',
      },
      dispatchStatus: {
        state: 'terminal',
        reason: 'codex_auth_unavailable',
        terminal: true,
        severity: 'critical',
        message: 'No reachable worker has active Codex auth.',
        remediation: 'Authorize Codex on home-dev, or select another available worker type.',
        workerNames: ['home-dev'],
        firstSeenAt: '2026-07-27T14:28:15.885Z',
        lastSeenAt: '2026-07-27T14:28:15.885Z',
        nextAction: 'retry_after_fix',
      },
    } as CodeTask;

    render(React.createElement(IssueTimeline, { tasks: [task], onCollapse: vi.fn() }));

    expect(screen.getByText('Never started')).toBeTruthy();
    expect(screen.getByText('A summary remains visible')).toBeTruthy();
    expect(screen.getByText('No reachable worker has active Codex auth.')).toBeTruthy();
    expect(screen.getByText('Codex authorization unavailable')).toBeTruthy();
    expect(
      screen.getByText(
        'Choose a worker with active Codex authorization, or configure authorization on a worker intended to run Codex tasks.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Authorize Codex on home-dev/)).toBeNull();
    expect(screen.queryByText('codex_auth_unavailable')).toBeNull();
    expect(screen.getByRole('link', { name: 'https://github.com/test/repo/pull/42' })).toBeTruthy();
  });

  it('uses warning styling for a non-terminal dispatch wait', () => {
    const task = {
      id: 'task-waiting',
      userId: 'user-1',
      prompt: 'Task prompt',
      sanitizedPrompt: 'Task prompt',
      systemPromptHash: 'hash-1',
      workerType: 'codex',
      workerLocation: 'home-dev',
      repository: 'test/repo',
      baseBranch: 'development',
      traceId: 'trace-1',
      status: 'queued',
      dedupKey: 'dedup-1',
      callbackReceived: false,
      createdAt: '2026-07-27T14:20:00.000Z',
      statusChangedAt: '2026-07-27T14:28:15.885Z',
      updatedAt: '2026-07-27T14:28:15.885Z',
      dispatchStatus: {
        state: 'waiting',
        reason: 'workers_at_capacity',
        terminal: false,
        severity: 'warning',
        message: 'All capable workers are currently at capacity.',
        remediation: 'Wait for a running task to finish.',
        workerNames: ['home-dev'],
        firstSeenAt: '2026-07-27T14:28:15.885Z',
        lastSeenAt: '2026-07-27T14:28:15.885Z',
        nextAction: 'will_retry_automatically',
      },
    } as CodeTask;

    render(React.createElement(IssueTimeline, { tasks: [task], onCollapse: vi.fn() }));

    const reason = screen.getByText('Workers at capacity');
    expect(reason.classList.contains('text-amber-700')).toBe(true);
    expect(reason.classList.contains('text-red-700')).toBe(false);
  });
});
