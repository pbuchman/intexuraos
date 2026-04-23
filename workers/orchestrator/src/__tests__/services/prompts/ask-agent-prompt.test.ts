import { describe, expect, it } from 'vitest';

import { askAgentPrompt } from '../../../services/system-prompt.js';

const canonicalParams = {
  taskId: 'task_INT1427',
  linearIssueId: 'INT-1427',
  linearIssueTitle: 'Refactor system-prompt',
  taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_INT1427',
  linearIssueLabels: [],
  workerType: 'opus' as const,
  modelName: 'claude-sonnet-4.5',
  agentType: 'ask_agent' as const,
};

describe('askAgentPrompt', () => {
  it('matches snapshot for standard ask-agent input', () => {
    const prompt = askAgentPrompt.build(canonicalParams);
    expect(prompt).toContain('[ASK AGENT MODE]');
    expect(prompt).toMatchSnapshot();
  });
});
