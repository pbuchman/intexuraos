import { describe, expect, it } from 'vitest';

import { executionPrompt, buildSystemPrompt } from '../services/system-prompt.js';

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

describe('buildSystemPrompt (review agent)', () => {
  const baseParams = {
    taskId: 'task-review-test',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    linearIssueLabels: [],
    agentType: 'review' as const,
    worktreePath: '/tmp/worktree',
    webhookUrl: 'https://example.com/webhook',
    workerType: 'auto' as const,
  };

  it('includes needs_remediation field in REVIEW_AGENT_FINAL block', () => {
    const prompt = buildSystemPrompt(baseParams);
    expect(prompt).toContain('needs_remediation');
  });

  it('REVIEW_AGENT_FINAL block contains needs_remediation between gh_actions_status and Summary', () => {
    const prompt = buildSystemPrompt(baseParams);
    const ghActionsIdx = prompt.indexOf('gh_actions_status');
    const needsRemIdx = prompt.indexOf('needs_remediation');
    const summaryIdx = prompt.lastIndexOf('Summary:');
    expect(ghActionsIdx).toBeGreaterThan(-1);
    expect(needsRemIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(needsRemIdx).toBeGreaterThan(ghActionsIdx);
    expect(summaryIdx).toBeGreaterThan(needsRemIdx);
  });
});
