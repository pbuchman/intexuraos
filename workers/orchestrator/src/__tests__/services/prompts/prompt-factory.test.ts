import { describe, expect, it } from 'vitest';

import {
  askAgentPrompt,
  systemPrompt,
  executionPrompt,
  getPromptForAgent,
  planningPrompt,
  pullRequestPrompt,
  remediationPrompt,
  reviewPrompt,
} from '../../../services/system-prompt.js';

const baseParams = {
  taskId: 'task_INT1427',
  linearIssueId: 'INT-1427',
  linearIssueTitle: 'Refactor system-prompt',
  taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_INT1427',
  linearIssueLabels: [],
  workerType: 'opus' as const,
  modelName: 'claude-sonnet-4.5',
};

describe('getPromptForAgent', () => {
  it('returns planningPrompt for planning', () => {
    expect(getPromptForAgent('planning')).toBe(planningPrompt);
  });

  it('returns executionPrompt for execution', () => {
    expect(getPromptForAgent('execution')).toBe(executionPrompt);
  });

  it('returns pullRequestPrompt for pull_request', () => {
    expect(getPromptForAgent('pull_request')).toBe(pullRequestPrompt);
  });

  it('returns reviewPrompt for review', () => {
    expect(getPromptForAgent('review')).toBe(reviewPrompt);
  });

  it('returns remediationPrompt for remediation', () => {
    expect(getPromptForAgent('remediation')).toBe(remediationPrompt);
  });

  it('returns askAgentPrompt for ask_agent', () => {
    expect(getPromptForAgent('ask_agent')).toBe(askAgentPrompt);
  });
});

describe('buildSystemPrompt dispatch', () => {
  it('appends PR review overlay for execution agent', () => {
    const prompt = systemPrompt.build({
      ...baseParams,
      agentType: 'execution',
    });
    expect(prompt).toContain('[PR REVIEW MODE — CONDITIONAL]');
  });

  it('appends PR review overlay for planning agent', () => {
    const prompt = systemPrompt.build({
      ...baseParams,
      agentType: 'planning',
    });
    expect(prompt).toContain('[PR REVIEW MODE — CONDITIONAL]');
  });

  it('does NOT append PR review overlay for review agent', () => {
    const prompt = systemPrompt.build({
      ...baseParams,
      agentType: 'review',
    });
    expect(prompt).not.toContain('[PR REVIEW MODE — CONDITIONAL]');
  });

  it('does NOT append PR review overlay for remediation agent', () => {
    const prompt = systemPrompt.build({
      ...baseParams,
      agentType: 'remediation',
    });
    expect(prompt).not.toContain('[PR REVIEW MODE — CONDITIONAL]');
  });

  it('uses pull request prompt when pr-comment label is present', () => {
    const prompt = systemPrompt.build({
      ...baseParams,
      linearIssueLabels: ['pr-comment'],
    });
    expect(prompt).toContain('[AGENT:PULL_REQUEST]');
  });

  it('uses pull request prompt when pr-comment label has mixed case / whitespace', () => {
    const prompt = systemPrompt.build({
      ...baseParams,
      linearIssueLabels: ['  PR-Comment  '],
    });
    expect(prompt).toContain('[AGENT:PULL_REQUEST]');
  });

  it('uses ask agent prompt when agentType is ask_agent', () => {
    const prompt = systemPrompt.build({
      ...baseParams,
      agentType: 'ask_agent',
    });
    expect(prompt).toContain('[ASK AGENT MODE]');
  });
});
