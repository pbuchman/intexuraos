import { describe, expect, it } from 'vitest';

import { planningPrompt } from '../../../services/system-prompt.js';

const canonicalParams = {
  taskId: 'task_INT1427',
  linearIssueId: 'INT-1427',
  linearIssueTitle: 'Refactor system-prompt',
  taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_INT1427',
  linearIssueLabels: [],
  workerType: 'opus' as const,
  modelName: 'claude-sonnet-4.5',
};

describe('planningPrompt', () => {
  it('matches snapshot for standard planning input', () => {
    expect(planningPrompt.build(canonicalParams)).toMatchSnapshot();
  });
});
