import { describe, expect, it } from 'vitest';

import { reviewPrompt } from '../../../services/system-prompt.js';

const canonicalParams = {
  taskId: 'task_INT1427',
  linearIssueId: 'INT-1427',
  linearIssueTitle: 'Refactor system-prompt',
  taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_INT1427',
  linearIssueLabels: [],
  workerType: 'opus' as const,
  modelName: 'claude-sonnet-4.5',
  agentType: 'review' as const,
};

describe('reviewPrompt', () => {
  it('matches snapshot for standard review input', () => {
    const prompt = reviewPrompt.build(canonicalParams);
    expect(prompt).toContain('Per-Type Review Structure');
    expect(prompt).toContain('Automated Code Review Started');
    expect(prompt).toMatchSnapshot();
  });
});
