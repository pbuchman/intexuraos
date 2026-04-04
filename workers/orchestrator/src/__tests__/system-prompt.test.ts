import { describe, expect, it } from 'vitest';

import {
  executionPrompt,
  planningPrompt,
  reviewPrompt,
  remediationPrompt,
  pullRequestPrompt,
  buildSystemPrompt,
} from '../services/system-prompt.js';
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

  it('includes execution memory section when context has matched memories', () => {
    const prompt = executionPrompt.build({
      taskId: 'task-exec-456',
      linearIssueLabels: [],
      executionMemoryContext: {
        applicationId: 'app-456',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Execution memory test',
        matchedMemories: [
          {
            memoryId: 'mem-exec-1',
            title: 'Execution memory pattern',
            memoryType: 'pitfall_pattern',
            score: 0.8,
            appliesWhen: 'When executing',
            action: 'Do this',
            avoid: 'Avoid that',
            verification: 'Check this',
          },
        ],
      },
    });

    expect(prompt).toContain('### Execution Memory');
    expect(prompt).toContain('mem-exec-1');
    expect(prompt).toContain('execution_memory_ids_used');
    expect(prompt).toContain('Memory Acknowledgment (MANDATORY)');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = executionPrompt.build({
      taskId: 'task-exec-789',
      linearIssueLabels: [],
    });

    expect(prompt).not.toContain('### Execution Memory');
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

describe('buildExecutionMemorySection acknowledgment and reporting', () => {
  const memoryContext = {
    applicationId: 'app-ack-test',
    retrievalVersion: 'execution-memory-retrieval@1.0.0',
    querySummary: 'Test acknowledgment instructions',
    matchedMemories: [
      {
        memoryId: 'mem-ack-1',
        title: 'First memory title',
        memoryType: 'implementation_pattern' as const,
        score: 0.9,
        appliesWhen: 'Always',
        action: 'Do something',
        avoid: 'Avoid something',
        verification: 'Check something',
      },
      {
        memoryId: 'mem-ack-2',
        title: 'Second memory title',
        memoryType: 'verification_pattern' as const,
        score: 0.8,
        appliesWhen: 'Sometimes',
        action: 'Do another thing',
        avoid: 'Avoid another thing',
        verification: 'Check another thing',
      },
    ],
  };

  it('includes mandatory memory acknowledgment instructions when memories are matched', () => {
    const prompt = planningPrompt.build({
      taskId: 'task-ack-test',
      linearIssueLabels: [],
      executionMemoryContext: memoryContext,
    });

    expect(prompt).toContain('MANDATORY');
    expect(prompt).toContain('Immediately after reading the Linear issue');
    expect(prompt).toContain('execution_memory_ids_used');
    expect(prompt).toContain('execution_memory_ids_rejected');
  });

  it('includes memory usage reporting instructions when memories are matched', () => {
    const prompt = planningPrompt.build({
      taskId: 'task-report-test',
      linearIssueLabels: [],
      executionMemoryContext: memoryContext,
    });

    expect(prompt).toContain('Memory Usage Reporting');
    expect(prompt).toContain('execution_memory_ids_used');
    expect(prompt).toContain('execution_memory_ids_rejected');
    expect(prompt).toContain('execution_memory_usage_summary');
  });

  it('does not include acknowledgment or reporting when no memories matched', () => {
    const prompt = planningPrompt.build({
      taskId: 'task-no-mem',
      linearIssueLabels: [],
    });

    expect(prompt).not.toContain('Memory Acknowledgment');
    expect(prompt).not.toContain('Memory Usage Reporting');
    expect(prompt).not.toContain('execution_memory_ids_used');
  });
});

describe('remediationPrompt', () => {
  it('includes execution memory section when context has matched memories', () => {
    const prompt = remediationPrompt.build({
      taskId: 'task-rem-123',
      linearIssueLabels: [],
      agentType: 'remediation',
      executionMemoryContext: {
        applicationId: 'app-rem',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Remediation memory context',
        matchedMemories: [
          {
            memoryId: 'mem-rem-1',
            title: 'Remediation pattern',
            memoryType: 'pitfall_pattern',
            score: 0.88,
            appliesWhen: 'Review findings remediation',
            action: 'Fix review findings',
            avoid: 'Ignoring findings',
            verification: 'All findings addressed',
          },
        ],
      },
    });

    expect(prompt).toContain('### Execution Memory');
    expect(prompt).toContain('mem-rem-1');
    expect(prompt).toContain('Remediation pattern');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = remediationPrompt.build({
      taskId: 'task-rem-123',
      linearIssueLabels: [],
      agentType: 'remediation',
    });

    expect(prompt).not.toContain('### Execution Memory');
  });
});

describe('pullRequestPrompt', () => {
  it('includes execution memory section when context has matched memories', () => {
    const prompt = pullRequestPrompt.build({
      taskId: 'task-pr-123',
      linearIssueLabels: [],
      agentType: 'pull_request',
      executionMemoryContext: {
        applicationId: 'app-pr',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'PR memory context',
        matchedMemories: [
          {
            memoryId: 'mem-pr-1',
            title: 'PR feedback pattern',
            memoryType: 'review_finding',
            score: 0.91,
            appliesWhen: 'PR feedback handling',
            action: 'Address all feedback',
            avoid: 'Skipping feedback',
            verification: 'All comments resolved',
          },
        ],
      },
    });

    expect(prompt).toContain('### Execution Memory');
    expect(prompt).toContain('mem-pr-1');
    expect(prompt).toContain('PR feedback pattern');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = pullRequestPrompt.build({
      taskId: 'task-pr-123',
      linearIssueLabels: [],
      agentType: 'pull_request',
    });

    expect(prompt).not.toContain('### Execution Memory');
  });
});

describe('prompt versions', () => {
  it('reviewPrompt version is 9.1.0', () => {
    expect(reviewPrompt.version).toBe('9.1.0');
  });

  it('pullRequestPrompt version is 4.2.0', () => {
    expect(pullRequestPrompt.version).toBe('4.2.0');
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
