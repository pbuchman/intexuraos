import { describe, expect, it } from 'vitest';

import { executionPrompt, planningPrompt, reviewPrompt, buildSystemPrompt } from '../services/system-prompt.js';
import { REVIEW_SCHEMA } from '../services/completion-verifier.js';

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

describe('planningPrompt', () => {
  it('includes execution memory section when context has matched memories', () => {
    const prompt = planningPrompt.build({
      taskId: 'task-plan-123',
      linearIssueLabels: [],
      executionMemoryContext: {
        applicationId: 'app-123',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Planning decomposition pattern',
        matchedMemories: [
          {
            memoryId: 'mem-1',
            title: 'Decompose by service boundary',
            memoryType: 'decomposition_pattern',
            score: 0.85,
            appliesWhen: 'Multi-service issue decomposition',
            action: 'Split by service',
            avoid: 'Cross-service subtasks',
            verification: 'Each subtask touches one service',
          },
        ],
      },
    });

    expect(prompt).toContain('### Execution Memory');
    expect(prompt).toContain('mem-1');
    expect(prompt).toContain('Decompose by service boundary');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = planningPrompt.build({
      taskId: 'task-plan-123',
      linearIssueLabels: [],
    });

    expect(prompt).not.toContain('### Execution Memory');
  });
});

describe('reviewPrompt', () => {
  it('includes execution memory section when context has matched memories', () => {
    const prompt = reviewPrompt.build({
      taskId: 'task-review-123',
      linearIssueLabels: [],
      agentType: 'review',
      executionMemoryContext: {
        applicationId: 'app-456',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Review finding about error handling',
        matchedMemories: [
          {
            memoryId: 'mem-2',
            title: 'Always validate error responses',
            memoryType: 'review_finding',
            score: 0.92,
            appliesWhen: 'HTTP error handling review',
            action: 'Check all error paths',
            avoid: 'Silent error swallowing',
            verification: 'Every catch block logs or returns error',
          },
        ],
      },
    });

    expect(prompt).toContain('### Execution Memory');
    expect(prompt).toContain('mem-2');
    expect(prompt).toContain('Always validate error responses');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = reviewPrompt.build({
      taskId: 'task-review-123',
      linearIssueLabels: [],
      agentType: 'review',
    });

    expect(prompt).not.toContain('### Execution Memory');
  });
});

describe('REVIEW_SCHEMA', () => {
  it('accepts review_body and review_inline_comments', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/test/repo/pull/1',
      review_comments_posted: '3',
      review_types: 'code_quality security',
      summary: 'Reviewed the PR',
      review_body: 'Overall looks good with minor issues',
      review_inline_comments: '[{"path":"src/foo.ts","line":10,"body":"Fix this"}]',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.review_body).toBe('Overall looks good with minor issues');
    expect(result.data.review_inline_comments).toBe(
      '[{"path":"src/foo.ts","line":10,"body":"Fix this"}]'
    );
  });

  it('defaults review_body and review_inline_comments to empty strings when absent', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/test/repo/pull/1',
      review_comments_posted: '3',
      review_types: 'code_quality security',
      summary: 'Reviewed the PR',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.review_body).toBe('');
    expect(result.data.review_inline_comments).toBe('');
  });
});
