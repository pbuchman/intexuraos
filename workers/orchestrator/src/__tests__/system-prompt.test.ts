import { describe, expect, it } from 'vitest';

import { executionPrompt } from '../services/system-prompt.js';

describe('executionPrompt', () => {
  it('renders non-finite execution memory scores without toFixed formatting', () => {
    const prompt = executionPrompt.build({
      taskId: 'task-123',
      linearIssueLabels: ['code-task'],
      executionMemoryContext: {
        applicationId: 'app-123',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Callback logging and verification work',
        matchedMemories: [
          {
            memoryId: 'mem-1',
            title: 'Verify route serialization',
            memoryType: 'verification_pattern',
            score: Number.POSITIVE_INFINITY,
            appliesWhen: 'Callback routes change',
            action: 'Add route coverage',
            avoid: 'Do not skip response verification',
            verification: 'Use app.inject',
          },
        ],
      },
    });

    expect(prompt).toContain('- Score: Infinity');
  });
});
