import { describe, expect, it } from 'vitest';

import { executionPrompt } from '../../../services/system-prompt.js';

const canonicalParams = {
  taskId: 'task_INT1427',
  linearIssueId: 'INT-1427',
  linearIssueTitle: 'Refactor system-prompt',
  taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_INT1427',
  linearIssueLabels: [],
  workerType: 'opus' as const,
  modelName: 'claude-sonnet-4.5',
  agentType: 'execution' as const,
};

describe('executionPrompt', () => {
  it('matches snapshot for standard execution input', () => {
    expect(executionPrompt.build(canonicalParams)).toMatchSnapshot();
  });

  it('matches snapshot for execution input with memory context', () => {
    const prompt = executionPrompt.build({
      ...canonicalParams,
      executionMemoryContext: {
        applicationId: 'app-snap',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'canonical execution memory snapshot',
        matchedMemories: [
          {
            memoryId: 'mem-abc',
            title: 'Canonical execution memory',
            memoryType: 'implementation_pattern',
            score: 0.9,
            appliesWhen: 'Always',
            action: 'Do the canonical thing',
            avoid: 'Avoid the canonical antipattern',
            verification: 'Verify canonically',
          },
        ],
      },
    });

    expect(prompt).toContain('### Execution Memory Context');
    expect(prompt).toContain('mem-abc');
    expect(prompt).toMatchSnapshot();
  });
});
