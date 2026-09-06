import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodeTask } from '@/types';
import type { IssueGroup } from '@/types/issueGroups';
import { IssueGroupRow } from '../IssueGroupRow.js';

function createTask(overrides: Partial<CodeTask> & { id: string }): CodeTask {
  const { id, ...rest } = overrides;

  return {
    id,
    userId: 'user-123',
    prompt: 'Fallback prompt for code task',
    sanitizedPrompt: 'Fallback prompt for code task',
    systemPromptHash: 'hash-123',
    workerType: 'auto',
    workerLocation: 'mac',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-123',
    status: 'planned',
    dedupKey: 'dedup-123',
    callbackReceived: false,
    createdAt: '2026-03-06T12:00:00.000Z',
    statusChangedAt: '2026-03-06T12:05:00.000Z',
    updatedAt: '2026-03-06T12:05:00.000Z',
    agentType: 'planning',
    ...rest,
  };
}

describe('IssueGroupRow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders parent breadcrumbs for subtask linear issues', () => {
    const task = createTask({
      id: 'task-123',
      linearIssueId: 'INT-1154',
      linearIssue: {
        identifier: 'INT-1154',
        parentIdentifier: 'INT-1121',
        title: 'Child Linear Issue',
        state: { name: 'In Progress', type: 'started' },
        priority: 1,
        assignee: null,
        labels: [{ id: 'label-1', name: 'backend' }],
        url: 'https://linear.app/pbuchman/issue/INT-1154',
        commentCount: 0,
        lastCommentAt: null,
      },
    });
    const group: IssueGroup = {
      linearIssueId: 'INT-1154',
      linearIssue: task.linearIssue,
      tasks: [task],
      pipeline: { steps: [], pr: null, failedAttempts: 0, archivedCount: 0 },
      latestTask: task,
      aggregateStatus: 'active',
      lastActivityAt: task.statusChangedAt,
      lastActivityStatus: task.status,
      lastActivityTaskId: task.id,
      lastModifiedAt: task.updatedAt,
    };

    const html = renderToStaticMarkup(createElement(IssueGroupRow, {
      group,
      timeTick: 0,
      onAction: (_taskId: string, _action: 'delete' | 'retry' | 'implement' | 'archive'): void => { /* stub */ },
      onArchiveGroup: (_taskIds: string[]): void => { /* stub */ },
      onDeleteGroup: (_taskIds: string[]): void => { /* stub */ },
      onOpenLogs: (_taskId: string): void => { /* stub */ },
      actioningTaskId: null,
    }));

    expect(html).toContain('INT-1121');
    expect(html).toContain('href="https://linear.app/pbuchman/issue/INT-1154"');
    expect(html).not.toContain('href="https://linear.app/pbuchman/issue/INT-1121"');
    expect(html).toContain('→');
  });

  it('shows the group lifecycle event on desktop and mobile without moving on metadata writes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T14:35:00.000Z'));

    const task = createTask({
      id: 'task-failed',
      status: 'failed',
      statusChangedAt: '2026-07-27T14:28:15.885Z',
      completedAt: '2026-07-27T14:28:15.885Z',
      updatedAt: '2026-07-27T15:35:09.634Z',
    });
    const baseGroup: IssueGroup = {
      linearIssueId: null,
      linearIssue: undefined,
      tasks: [task],
      pipeline: { steps: [], pr: null, failedAttempts: 1, archivedCount: 0 },
      latestTask: task,
      aggregateStatus: 'failed',
      lastActivityAt: '2026-07-27T14:28:15.885Z',
      lastActivityStatus: 'failed',
      lastActivityTaskId: task.id,
      lastModifiedAt: '2026-07-27T15:35:09.634Z',
    };
    const renderGroup = (group: IssueGroup): string => renderToStaticMarkup(createElement(IssueGroupRow, {
      group,
      timeTick: 1,
      onAction: (): void => { /* stub */ },
      onArchiveGroup: (): void => { /* stub */ },
      onDeleteGroup: (): void => { /* stub */ },
      onOpenLogs: (): void => { /* stub */ },
    }));

    const beforeMetadataWrite = renderGroup(baseGroup);
    const afterMetadataWrite = renderGroup({
      ...baseGroup,
      lastModifiedAt: '2026-07-27T16:00:00.000Z',
      latestTask: { ...task, updatedAt: '2026-07-27T16:00:00.000Z' },
    });

    expect(beforeMetadataWrite.match(/dateTime="2026-07-27T14:28:15.885Z"/g)).toHaveLength(2);
    expect(afterMetadataWrite.match(/dateTime="2026-07-27T14:28:15.885Z"/g)).toHaveLength(2);
    expect(beforeMetadataWrite).not.toContain('dateTime="2026-07-27T15:35:09.634Z"');
    expect(afterMetadataWrite).not.toContain('dateTime="2026-07-27T16:00:00.000Z"');
    expect(beforeMetadataWrite).not.toContain('Updated');
    expect(afterMetadataWrite).not.toContain('Updated');
  });
});
