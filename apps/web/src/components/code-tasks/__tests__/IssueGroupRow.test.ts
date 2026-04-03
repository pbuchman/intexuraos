import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CodeTask } from '@/types';
import type { IssueGroup } from '@/types/issueGroups';
import { IssueGroupRow } from '../IssueGroupRow.js';
import type { IssueGroupRowProps } from '../IssueGroupRow.js';

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
    updatedAt: '2026-03-06T12:05:00.000Z',
    agentType: 'planning',
    ...rest,
  };
}

describe('IssueGroupRow', () => {
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
    };

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const noop = (): void => {};
    const html = renderToStaticMarkup(createElement(IssueGroupRow, {
      group,
      timeTick: 0,
      onAction: noop as IssueGroupRowProps['onAction'],
      onArchiveGroup: noop as IssueGroupRowProps['onArchiveGroup'],
      onDeleteGroup: noop as IssueGroupRowProps['onDeleteGroup'],
      onOpenLogs: noop as IssueGroupRowProps['onOpenLogs'],
      actioningTaskId: null,
    }));

    expect(html).toContain('INT-1121');
    expect(html).toContain('href="https://linear.app/pbuchman/issue/INT-1154"');
    expect(html).not.toContain('href="https://linear.app/pbuchman/issue/INT-1121"');
    expect(html).toContain('→');
  });
});
