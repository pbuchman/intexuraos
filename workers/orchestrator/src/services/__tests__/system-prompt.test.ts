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
    expect(result).toContain('executable in PARALLEL');
    expect(result).toContain('service/package boundaries');
    expect(result).toContain('If only ONE child issue');
    expect(result).toContain('If MULTIPLE child issues');
    expect(result).toContain('Child issues:');
    expect(result).toContain('FLAT');
    expect(result).not.toContain('Trivial task');
    expect(result).not.toContain('non-trivial');
    expect(result).toContain('PLANNING_AGENT_FINAL:');
  });

  it('includes PR Description Format in planning prompt with Linear link, task URL, and worker type', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['bug'],
      linearIssueTitle: 'Fix login bug',
      taskUrl: 'https://intexuraos.cloud/tasks/task-123',
    });

    expect(result).toContain('### PR Description Format');
    expect(result).toContain(
      '- Linear: [INT-123 Fix login bug](https://linear.app/pbuchman/issue/INT-123)'
    );
    expect(result).toContain(
      '- IntexuraOS Code Task: [View task](https://intexuraos.cloud/tasks/task-123)'
    );
    expect(result).toContain('- Worker Type: `auto`');
  });

  it('renders PR Description Format with fallback values when optional fields are missing', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('- Linear: [INT-123](https://linear.app/pbuchman/issue/INT-123)');
    expect(result).not.toContain('IntexuraOS Code Task');
    expect(result).toContain('- Worker Type: `auto`');
  });

  it('builds execution agent prompt with execution marker and final block', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('[WORKER-MODE]');
    expect(result).toContain('[AGENT:EXECUTION]');
    expect(result).toContain('[EXECUTION AGENT MODE]');
    expect(result).toContain('source of truth');
    expect(result).toContain('DO NOT use the `/linear` skill/command');
    expect(result).toContain('superpowers:executing-plans');
    expect(result).toContain('superpowers:requesting-code-review');
    expect(result).toContain('gh pr create');
    expect(result).toContain('EXECUTION_AGENT_FINAL:');
    expect(result).toContain('- Outcome: implemented');
    expect(result).toContain('- Review iterations: <number>');
    expect(result).toContain('- Skill sequence proof:');
    expect(result).not.toContain('- Turn summary:');
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

  it('requires gathering feedback from both PR and issue comments', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('### Gathering Feedback');
    expect(result).toContain('PR reviews');
    expect(result).toContain('PR comments');
    expect(result).toContain('issue comments');
  });

  it('includes Tracking Comment section with taskUrl in PR prompt', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
      taskUrl: 'https://intexuraos.cloud/tasks/task-123',
    });

    expect(result).toContain('### Tracking Comment');
    expect(result).toContain('FIRST action');
    expect(result).toContain('LAST action');
    expect(result).toContain('https://intexuraos.cloud/tasks/task-123');
    expect(result).toContain('Tracking comment:');
  });

  it('includes Tracking comment line in PULL_REQUEST_AGENT_FINAL contract', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('- Tracking comment: <updated|not_applicable>');
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

  it('includes PR review overlay in execution prompt', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task'],
      taskUrl: 'https://intexuraos.cloud/tasks/task-123',
    });

    expect(result).toContain('[PR REVIEW MODE');
    expect(result).toContain('Detecting PR Review Intent');
    expect(result).toContain('Gathering Feedback');
    expect(result).toContain('Tracking Comment');
    expect(result).toContain('PULL_REQUEST_AGENT_FINAL:');
    expect(result).toContain('https://intexuraos.cloud/tasks/task-123');
    // Must still have the base execution markers
    expect(result).toContain('[AGENT:EXECUTION]');
    expect(result).toContain('EXECUTION_AGENT_FINAL:');
  });

  it('includes PR review overlay in planning prompt', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['bug'],
      taskUrl: 'https://intexuraos.cloud/tasks/task-123',
    });

    expect(result).toContain('[PR REVIEW MODE');
    expect(result).toContain('Detecting PR Review Intent');
    expect(result).toContain('Gathering Feedback');
    expect(result).toContain('Tracking Comment');
    expect(result).toContain('PULL_REQUEST_AGENT_FINAL:');
    // Must still have the base planning markers
    expect(result).toContain('[AGENT:PLANNING]');
    expect(result).toContain('PLANNING_AGENT_FINAL:');
  });

  it('does not include PR review overlay in pull request prompt (already native)', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('[AGENT:PULL_REQUEST]');
    expect(result).not.toContain('[PR REVIEW MODE');
  });

  it('renders PR review overlay without task URL when taskUrl is undefined', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task'],
    });

    expect(result).toContain('[PR REVIEW MODE');
    expect(result).not.toContain('View progress');
    expect(result).not.toContain('View task');
  });
});
