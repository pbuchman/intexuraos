import { describe, expect, it } from 'vitest';

import { pullRequestPrompt } from '../../../services/system-prompt.js';

const canonicalParams = {
  taskId: 'task_INT1427',
  linearIssueId: 'INT-1427',
  linearIssueTitle: 'Refactor system-prompt',
  taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_INT1427',
  linearIssueLabels: [],
  workerType: 'opus' as const,
  modelName: 'claude-sonnet-4.5',
  agentType: 'pull_request' as const,
  trackingCommentId: 'c-123',
};

describe('pullRequestPrompt', () => {
  it('matches snapshot for standard pull request input', () => {
    const prompt = pullRequestPrompt.build(canonicalParams);
    expect(prompt).toContain('POST /issues/{pr_number}/comments');
    expect(prompt).toMatchSnapshot();
  });
});
