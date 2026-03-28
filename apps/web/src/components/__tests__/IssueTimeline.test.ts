/**
 * Tests for IssueTimeline.
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueTimeline } from '../code-tasks/IssueTimeline.js';
import type { CodeTask } from '@/types';

describe('IssueTimeline', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
      updatedAt: '2026-03-28T10:00:00.000Z',
      agentType: 'pull_request',
      followUpReason: 'merge_conflict',
    } as CodeTask;

    render(React.createElement(IssueTimeline, { tasks: [task], onCollapse: vi.fn() }));

    expect(screen.getByText('Merge Conflict')).toBeTruthy();
  });
});
