import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CodeTask } from '@/types';
import { groupByLinearIssue } from '@/utils/issueGroups';
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
    updatedAt: '2026-03-06T12:05:00.000Z',
    agentType: 'planning',
    ...rest,
  };
}

describe('IssueGroupRow', () => {
  it('renders parent breadcrumbs for subtask linear issues', () => {
    const [group] = groupByLinearIssue([
      createTask({
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
      }),
    ]);
    if (group === undefined) {
      throw new Error('Expected issue group to be created');
    }

    const html = renderToStaticMarkup(createElement(IssueGroupRow, {
      group,
      timeTick: 0,
      onAction: (taskId: string, action: 'delete' | 'retry' | 'implement'): void => {
        void taskId;
        void action;
      },
      onOpenLogs: (taskId: string): void => {
        void taskId;
      },
      actioningTaskId: null,
    }));

    expect(html).toContain('INT-1121');
    expect(html).toContain('href="https://linear.app/pbuchman/issue/INT-1154"');
    expect(html).not.toContain('href="https://linear.app/pbuchman/issue/INT-1121"');
    expect(html).toContain('→');
  });
});
