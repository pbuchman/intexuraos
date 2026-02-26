import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../system-prompt.js';

describe('system-prompt', () => {
  const baseParams = {
    taskId: 'task-123',
    linearIssueId: 'INT-123',
    linearIssueLabels: [] as string[],
    hasChildren: false,
    workerType: 'auto' as const,
  };

  it('builds planning agent prompt with required markers and rules', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('[WORKER-MODE]');
    expect(result).toContain('[AGENT:PLANNING]');
    expect(result).toContain('[PLANNING AGENT MODE]');
    expect(result).toContain('source of truth');
    expect(result).toContain('NO IMPLEMENTATION CODING IS ALLOWED');
    expect(result).toContain('docs/plans/');
    expect(result).toContain('superpowers:writing-plans');
    expect(result).toContain('parallel work breakdown');
    expect(result).toContain('service/package');
    expect(result).toContain('PLANNING_AGENT_FINAL:');
  });

  it('builds execution agent prompt with execution marker and final block', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('[WORKER-MODE]');
    expect(result).toContain('[AGENT:EXECUTION]');
    expect(result).toContain('[EXECUTION AGENT MODE]');
    expect(result).toContain('superpowers:executing-plans');
    expect(result).toContain('EXECUTION_AGENT_FINAL:');
    expect(result).toContain('- Review iterations: <number>');
    expect(result).toContain('- Turn summary:');
  });

  it('builds pull request agent prompt when pr-comment label is present', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('[AGENT:PULL_REQUEST]');
    expect(result).toContain('[PULL REQUEST AGENT MODE]');
    expect(result).toContain('PULL_REQUEST_AGENT_FINAL:');
    expect(result).not.toContain('[AGENT:EXECUTION]');
    expect(result).not.toContain('[AGENT:PLANNING]');
  });

  it('uses agentType=execution over missing code-task label', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['bug'],
      agentType: 'execution',
    });

    expect(result).toContain('[AGENT:EXECUTION]');
  });

  it('uses agentType=planning over present code-task label', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task'],
      agentType: 'planning',
    });

    expect(result).toContain('[AGENT:PLANNING]');
  });

  it('falls back to label detection when agentType is absent', () => {
    expect(buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] })).toContain(
      '[AGENT:EXECUTION]'
    );
    expect(buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] })).toContain(
      '[AGENT:PLANNING]'
    );
  });

  it('pr-comment takes priority over explicit agentType', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['pr-comment'],
      agentType: 'planning',
    });

    expect(result).toContain('[AGENT:PULL_REQUEST]');
  });
});
