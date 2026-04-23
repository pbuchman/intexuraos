import { describe, expect, it } from 'vitest';

import { remediationPrompt } from '../../../services/system-prompt.js';

const canonicalParams = {
  taskId: 'task_INT1427',
  linearIssueId: 'INT-1427',
  linearIssueTitle: 'Refactor system-prompt',
  taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_INT1427',
  linearIssueLabels: [],
  workerType: 'opus' as const,
  modelName: 'claude-sonnet-4.5',
  agentType: 'remediation' as const,
  continuationPrNumber: 42,
  continuationPrBranch: 'feature/foo',
};

describe('remediationPrompt', () => {
  it('matches snapshot for standard remediation input', () => {
    const prompt = remediationPrompt.build(canonicalParams);
    expect(prompt).toContain('/nitpick-nuker 42');
    expect(prompt).toMatchSnapshot();
  });
});
