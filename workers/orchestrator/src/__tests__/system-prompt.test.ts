import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../services/system-prompt.js';

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
