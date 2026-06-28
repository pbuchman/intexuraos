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
  sentryPrompt,
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

  it('returns sentryPrompt for sentry', () => {
    expect(getPromptForAgent('sentry')).toBe(sentryPrompt);
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

  it('uses Sentry prompt with issue context when agentType is sentry', () => {
    const prompt = systemPrompt.build({
      ...baseParams,
      agentType: 'sentry',
      sentryIssue: {
        organizationSlug: 'intexura',
        projectSlug: 'code-agent',
        projectId: 'project-1',
        issueId: '123456',
        issueShortId: 'CODE-1',
        issueUrl: 'https://intexura.sentry.io/issues/123456/',
        title: 'TypeError: cannot read property',
        action: 'created',
        eventId: 'event-1',
        receivedAt: '2026-06-28T12:00:00.000Z',
      },
    });

    expect(prompt).toContain('[AGENT:SENTRY]');
    expect(prompt).toContain('- Project ID: project-1');
    expect(prompt).toContain('- Short ID: CODE-1');
    expect(prompt).toContain('- Event ID: event-1');
    expect(prompt).toContain('https://intexura.sentry.io/issues/123456/');
    expect(prompt).toContain('Fetch current Sentry issue details');
    expect(prompt).toContain('recent events');
    expect(prompt).toContain('attempt reproduction');
    expect(prompt).toContain('SENTRY_AGENT_FINAL:');
    expect(prompt).toContain('outcome: <fixed|suppressed|failed>');
    expect(prompt).toContain('pr: <GitHub PR URL>');
  });

  it('uses Sentry prompt fallbacks when issue context and optional metadata are absent', () => {
    const {
      workerType: _workerType,
      modelName: _modelName,
      taskUrl: _taskUrl,
      ...params
    } = baseParams;
    const prompt = systemPrompt.build({
      ...params,
      agentType: 'sentry',
    });

    expect(prompt).toContain('- Organization: unknown');
    expect(prompt).toContain('- Issue URL: unknown');
    expect(prompt).toContain('- Sentry: <Sentry issue URL>');
    expect(prompt).toContain(
      '- Worker Type: `<auto|opus|sonnet|minimax|mimo-pro|glm|qwen|kimi|codex|codex-xhigh|openrouter-free>`'
    );
    expect(prompt).toContain('- Model: `default`');
    expect(prompt).not.toContain('IntexuraOS Code Task: [View task]');
  });
});
