import { describe, expect, it } from 'vitest';

import {
  executionPrompt,
  planningPrompt,
  reviewPrompt,
  remediationPrompt,
  pullRequestPrompt,
  systemPrompt,
} from '../services/system-prompt.js';

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

    expect(prompt).toContain('| Score: Infinity');
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

    expect(prompt).toContain('### Execution Memory Context');
    expect(prompt).toContain('mem-exec-1');
    expect(prompt).toContain('memory_ids_used');
    expect(prompt).toContain('MANDATORY: Acknowledge Execution Memories NOW');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = executionPrompt.build({
      taskId: 'task-exec-789',
      linearIssueLabels: [],
    });

    expect(prompt).not.toContain('### Execution Memory Context');
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
    const prompt = systemPrompt.build(baseParams);
    expect(prompt).toContain('needs_remediation');
  });

  it('REVIEW_AGENT_FINAL block contains needs_remediation between gh_actions_status and Summary', () => {
    const prompt = systemPrompt.build(baseParams);
    const ghActionsIdx = prompt.indexOf('gh_actions_status');
    const needsRemIdx = prompt.indexOf('needs_remediation');
    const summaryIdx = prompt.lastIndexOf('Summary:');
    expect(ghActionsIdx).toBeGreaterThan(-1);
    expect(needsRemIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(needsRemIdx).toBeGreaterThan(ghActionsIdx);
    expect(summaryIdx).toBeGreaterThan(needsRemIdx);
  });

  it('needs_remediation definition excludes operational/manual verification steps', () => {
    const prompt = systemPrompt.build(baseParams);
    expect(prompt).toContain('post-merge activities');
    expect(prompt).toContain('do NOT count as code remediation');
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

    expect(prompt).toContain('### Execution Memory Context');
    expect(prompt).toContain('mem-1');
    expect(prompt).toContain('Decompose by service boundary');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = planningPrompt.build({
      taskId: 'task-plan-123',
      linearIssueLabels: [],
    });

    expect(prompt).not.toContain('### Execution Memory Context');
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

    expect(prompt).toContain('### Execution Memory Context');
    expect(prompt).toContain('mem-2');
    expect(prompt).toContain('Always validate error responses');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = reviewPrompt.build({
      taskId: 'task-review-123',
      linearIssueLabels: [],
      agentType: 'review',
    });

    expect(prompt).not.toContain('### Execution Memory Context');
  });

  it('includes documentation review scope and per-type structure when requested', () => {
    const prompt = reviewPrompt.build({
      taskId: 'task-review-docs',
      linearIssueLabels: [],
      agentType: 'review',
      reviewTypes: ['documentation'],
    });

    expect(prompt).toContain('**documentation**');
    expect(prompt).toContain('documentation accuracy');
    expect(prompt).toContain('docs against the implementation');
    expect(prompt).toContain('### Documentation');
    expect(prompt).toContain('## Automated Code Review — documentation');
    expect(prompt).not.toContain('### 🔍 Code Quality');
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

    expect(prompt).toContain('MANDATORY: Acknowledge Execution Memories NOW');
    expect(prompt).toContain('IMMEDIATELY after reading the Linear issue');
    expect(prompt).toContain('machine-validated');
    expect(prompt).toContain('memory_ids_used');
    expect(prompt).toContain('memory_ids_rejected');
    expect(prompt).toContain('memory_usage_summary');
  });

  it('includes memory usage reporting instructions when memories are matched', () => {
    const prompt = planningPrompt.build({
      taskId: 'task-report-test',
      linearIssueLabels: [],
      executionMemoryContext: memoryContext,
    });

    expect(prompt).toContain('MANDATORY: Report Memory Usage in Final Output');
    expect(prompt).toContain('memory_ids_used');
    expect(prompt).toContain('memory_ids_rejected');
    expect(prompt).toContain('memory_usage_summary');
  });

  it('does not include acknowledgment or reporting instructions when no memories matched', () => {
    const prompt = planningPrompt.build({
      taskId: 'task-no-mem',
      linearIssueLabels: [],
    });

    expect(prompt).not.toContain('MANDATORY: Acknowledge Execution Memories NOW');
    expect(prompt).not.toContain('MANDATORY: Report Memory Usage in Final Output');
    // The final-block template still lists memory_ids_used with a "none" fallback so workers
    // always report these fields — even when no memories are injected.
    expect(prompt).toContain(
      'memory_ids_used: <comma-separated injected IDs you applied, or "none">'
    );
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

    expect(prompt).toContain('### Execution Memory Context');
    expect(prompt).toContain('mem-rem-1');
    expect(prompt).toContain('Remediation pattern');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = remediationPrompt.build({
      taskId: 'task-rem-123',
      linearIssueLabels: [],
      agentType: 'remediation',
    });

    expect(prompt).not.toContain('### Execution Memory Context');
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

    expect(prompt).toContain('### Execution Memory Context');
    expect(prompt).toContain('mem-pr-1');
    expect(prompt).toContain('PR feedback pattern');
  });

  it('does not include memory section when context is undefined', () => {
    const prompt = pullRequestPrompt.build({
      taskId: 'task-pr-123',
      linearIssueLabels: [],
      agentType: 'pull_request',
    });

    expect(prompt).not.toContain('### Execution Memory Context');
  });

  it('does not require or invent a Linear issue when none is associated', () => {
    const prompt = pullRequestPrompt.build({
      taskId: 'task-pr-no-linear',
      linearIssueLabels: [],
      agentType: 'pull_request',
    });

    expect(prompt).toContain('No Linear issue is associated');
    expect(prompt).toContain(
      'Linear issue: <full Linear URL, or "none" when no Linear issue is associated>'
    );
    expect(prompt).not.toContain('mcp__linear__get_issue');
    expect(prompt).not.toContain('INT-XXX');
    expect(prompt).not.toContain('https://linear.app/pbuchman/issue/undefined');
  });

  it('uses the real Linear identifier when a pull request task has one', () => {
    const prompt = pullRequestPrompt.build({
      taskId: 'task-pr-linear',
      linearIssueLabels: [],
      agentType: 'pull_request',
      linearIssueId: 'INT-123',
      linearIssueTitle: 'Fix docs review dispatch',
    });

    expect(prompt).toContain("mcp__linear__get_issue({ id: 'INT-123' })");
    expect(prompt).toContain(
      '[INT-123 Fix docs review dispatch](https://linear.app/pbuchman/issue/INT-123)'
    );
    expect(prompt).not.toContain('INT-XXX');
  });
});

describe('askAgentPrompt', () => {
  it('instructs ask-agent that resumed sessions carry prior turns without naming a specific CLI flag', () => {
    const result = systemPrompt.build({
      taskId: 'task_test',
      linearIssueLabels: [],
      workerType: 'opus',
      taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_test',
      agentType: 'ask_agent',
    });

    expect(result).toContain('Session Continuity');
    expect(result).not.toContain('--continue');
    expect(result).not.toContain('--resume');
    expect(result).toMatch(/prior (conversation|turns|context)/i);
  });
});

describe('prompt versions', () => {
  it('reviewPrompt version is 11.0.0', () => {
    expect(reviewPrompt.version).toBe('11.0.0');
  });

  it('pullRequestPrompt version is 6.1.0', () => {
    expect(pullRequestPrompt.version).toBe('6.1.0');
  });
});

// [INT-1470] REVIEW_SCHEMA was deleted with the LLM verifier. The review
// agent final block no longer emits `review_body` / `review_inline_comments` —
// those were LLM-invented fields, never in the live review prompt. TaskResult
// retains optional slots for them for wire back-compat, but the deterministic
// parser does not read or emit them.
