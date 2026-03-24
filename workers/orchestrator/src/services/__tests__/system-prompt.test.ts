import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  planningPrompt,
  executionPrompt,
  pullRequestPrompt,
  prReviewOverlayPrompt,
  reviewPrompt,
} from '../system-prompt.js';

describe('system-prompt', () => {
  const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

  describe('prompt versioning', () => {
    it.each([
      { name: 'planningPrompt', prompt: planningPrompt },
      { name: 'executionPrompt', prompt: executionPrompt },
      { name: 'pullRequestPrompt', prompt: pullRequestPrompt },
      { name: 'prReviewOverlayPrompt', prompt: prReviewOverlayPrompt },
      { name: 'reviewPrompt', prompt: reviewPrompt },
    ])('$name has valid semver version', ({ prompt }) => {
      expect(prompt.version).toMatch(SEMVER_REGEX);
    });

    it.each([
      { name: 'planningPrompt', prompt: planningPrompt },
      { name: 'executionPrompt', prompt: executionPrompt },
      { name: 'pullRequestPrompt', prompt: pullRequestPrompt },
      { name: 'prReviewOverlayPrompt', prompt: prReviewOverlayPrompt },
      { name: 'reviewPrompt', prompt: reviewPrompt },
    ])('$name has required metadata fields', ({ prompt }) => {
      expect(prompt.name).toBeTruthy();
      expect(prompt.description).toBeTruthy();
      expect(typeof prompt.build).toBe('function');
    });
  });

  const baseParams = {
    taskId: 'task-123',
    linearIssueId: 'INT-123',
    linearIssueLabels: [] as string[],
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
    expect(result).toContain('Parallel work breakdown');
    expect(result).toContain('service/package');
    expect(result).toContain('PLANNING_AGENT_FINAL:');
    expect(result).toContain('Plan document: docs/plans/<file>.md');
  });

  it('requires archiving issue content before editing in planning prompt', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('archive its current content by adding a Linear comment');
    // Archive instruction appears in both Planning Contract and Simple vs Complex sections
    const firstArchive = result.indexOf('archive its current content');
    const secondArchive = result.indexOf('archive its current content', firstArchive + 1);
    expect(secondArchive).toBeGreaterThan(firstArchive);
  });

  it('enforces strict parallel work breakdown rules for complex tasks', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('STRICT REQUIREMENT');
    expect(result).toContain('strict requirement for the agent executing the plan');
    expect(result).toContain('ALL subissues MUST be executable in parallel');
    expect(result).toContain('MUST NOT create any dependencies between issues');
    expect(result).toContain('input/output boundaries');
  });

  it('enforces Plan PR rules in PLANNING_AGENT_FINAL', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('NEVER for simple tasks, ALWAYS when subtasks are defined');
  });

  it('enforces Clarification message rules in PLANNING_AGENT_FINAL', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('REQUIRED for unclear outcomes');
    expect(result).toContain('MUST be empty for successfully planned outcomes');
  });

  it('requires proof of parallel breakdown showing boundaries for complex outcomes', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('show service boundaries and contracts between subissues');
    expect(result).toContain('agents can work on each subissue independently');
  });

  it('requires complexity judgment before any changes in planning prompt', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain(
      '### Complexity Judgment (MANDATORY — NON-NEGOTIABLE, after Reading section above)'
    );
    expect(result).toContain('COMPLEXITY_JUDGMENT:');
    expect(result).toContain('- Decision: <SIMPLE|COMPLEX>');
    expect(result).toContain(
      'Do NOT edit the issue, create subtasks, write docs, or open PRs until this block is output'
    );

    // Complexity Judgment section must appear BEFORE Simple vs Complex
    const judgmentIdx = result.indexOf('### Complexity Judgment');
    const simpleComplexIdx = result.indexOf('### Simple vs Complex');
    expect(judgmentIdx).toBeLessThan(simpleComplexIdx);
  });

  it('includes PR Description Format in planning prompt with Linear link, task URL, worker type, and model', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['bug'],
      linearIssueTitle: 'Fix login bug',
      taskUrl: 'https://intexuraos.cloud/tasks/task-123',
      modelName: 'glm-5',
    });

    expect(result).toContain('### PR Description Format');
    expect(result).toContain(
      '- Linear: [INT-123 Fix login bug](https://linear.app/pbuchman/issue/INT-123)'
    );
    expect(result).toContain(
      '- IntexuraOS Code Task: [View task](https://intexuraos.cloud/tasks/task-123)'
    );
    expect(result).toContain('- Worker Type: `auto`');
    expect(result).toContain('- Model: `glm-5`');
  });

  it('renders PR Description Format with fallback values when optional fields are missing', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('- Linear: [INT-123](https://linear.app/pbuchman/issue/INT-123)');
    expect(result).not.toContain('IntexuraOS Code Task');
    expect(result).toContain('- Worker Type: `auto`');
    expect(result).toContain('- Model: `default`');
  });

  it('planning prompt omits Linear Issue line when linearIssueId is undefined', () => {
    const { linearIssueId: _, ...paramsWithoutLinear } = baseParams;
    const result = planningPrompt.build({
      ...paramsWithoutLinear,
      linearIssueLabels: ['bug'],
    });

    expect(result).not.toContain('Linear Issue: INT-123');
    expect(result).toContain('[AGENT:PLANNING]');
  });

  it('execution prompt omits Linear Issue line when linearIssueId is undefined', () => {
    const { linearIssueId: _, ...paramsWithoutLinear } = baseParams;
    const result = executionPrompt.build({
      ...paramsWithoutLinear,
      linearIssueLabels: ['code-task'],
    });

    expect(result).not.toContain('Linear Issue: INT-123');
    expect(result).toContain('[AGENT:EXECUTION]');
  });

  it('pull request prompt omits Linear Issue line when linearIssueId is undefined', () => {
    const { linearIssueId: _, ...paramsWithoutLinear } = baseParams;
    const result = pullRequestPrompt.build({
      ...paramsWithoutLinear,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).not.toContain('Linear Issue: INT-123');
    expect(result).toContain('[AGENT:PULL_REQUEST]');
  });

  it('review prompt omits Linear Issue line when linearIssueId is undefined', () => {
    const { linearIssueId: _, ...paramsWithoutLinear } = baseParams;
    const result = reviewPrompt.build({
      ...paramsWithoutLinear,
      agentType: 'review',
    });

    expect(result).not.toContain('Linear Issue: INT-123');
    expect(result).toContain('[AGENT:REVIEW]');
  });

  it('execution prompt renders linearIssueTitle in PR Description when provided', () => {
    const result = executionPrompt.build({
      ...baseParams,
      linearIssueLabels: ['code-task'],
      linearIssueTitle: 'Fix login bug',
    });

    expect(result).toContain('[INT-123 Fix login bug]');
  });

  it('pull request prompt renders linearIssueTitle in PR Description when provided', () => {
    const result = pullRequestPrompt.build({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
      linearIssueTitle: 'Fix login bug',
    });

    expect(result).toContain('[INT-123 Fix login bug]');
  });

  it('planning prompt uses workerType fallback when workerType is undefined', () => {
    const { workerType: _, ...paramsWithoutWorkerType } = baseParams;
    const result = planningPrompt.build({
      ...paramsWithoutWorkerType,
      linearIssueLabels: ['bug'],
    });

    expect(result).toContain('`<auto|opus|sonnet|minimax|glm|qwen|kimi>`');
  });

  it('execution prompt uses workerType fallback when workerType is undefined', () => {
    const { workerType: _, ...paramsWithoutWorkerType } = baseParams;
    const result = executionPrompt.build({
      ...paramsWithoutWorkerType,
      linearIssueLabels: ['code-task'],
    });

    expect(result).toContain('`<auto|opus|sonnet|minimax|glm|qwen|kimi>`');
  });

  it('pull request prompt uses workerType fallback when workerType is undefined', () => {
    const { workerType: _, ...paramsWithoutWorkerType } = baseParams;
    const result = pullRequestPrompt.build({
      ...paramsWithoutWorkerType,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('`<auto|opus|sonnet|minimax|glm|qwen|kimi>`');
  });

  it('review prompt renders linearIssueTitle in PR Description when provided', () => {
    const result = reviewPrompt.build({
      ...baseParams,
      agentType: 'review',
      linearIssueTitle: 'Fix login bug',
    });

    expect(result).toContain('[INT-123 Fix login bug]');
  });

  it('review prompt uses workerType fallback when workerType is undefined', () => {
    const { workerType: _, ...paramsWithoutWorkerType } = baseParams;
    const result = reviewPrompt.build({
      ...paramsWithoutWorkerType,
      agentType: 'review',
    });

    expect(result).toContain('`<auto|opus|sonnet|minimax|glm|qwen|kimi>`');
  });

  it('review prompt renders taskUrl in View in IntexuraOS link and code task line', () => {
    const result = reviewPrompt.build({
      ...baseParams,
      agentType: 'review',
      taskUrl: 'https://intexuraos.cloud/#/code-tasks/task-456',
    });

    expect(result).toContain(
      '[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/task-456)'
    );
    expect(result).toContain('[View task](https://intexuraos.cloud/#/code-tasks/task-456)');
  });

  it('includes mandatory Worker Type and Model emphasis in all prompt types', () => {
    const planningResult = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });
    const executionResult = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task'],
    });
    const prResult = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });
    const reviewResult = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    for (const result of [planningResult, executionResult, prResult, reviewResult]) {
      expect(result).toContain('Worker Type and Model lines are MANDATORY and NON-NEGOTIABLE');
      expect(result).toContain('- Worker Type:');
      expect(result).toContain('- Model:');
    }
  });

  it('includes PR Title Format section in planning prompt with [plan] tag', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('### PR Title Format');
    expect(result).toContain('`[INT-XXX] [plan] title`');
  });

  it('includes PR Title Format section in execution prompt without [plan] tag', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('### PR Title Format');
    expect(result).toContain('`[INT-XXX] title`');
    expect(result).not.toMatch(/\[INT-XXX\] \[plan\] title/);
  });

  it('builds execution agent prompt with execution marker and final block', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('[WORKER-MODE]');
    expect(result).toContain('[AGENT:EXECUTION]');
    expect(result).toContain('[EXECUTION AGENT MODE]');
    expect(result).toContain('source of truth');
    expect(result).toContain('Linear MCP tools');
    expect(result).toContain('Do NOT use the `/linear` skill');
    expect(result).toContain('superpowers:executing-plans');
    expect(result).toContain('superpowers:requesting-code-review');
    expect(result).toContain('gh pr create');
    expect(result).toContain('EXECUTION_AGENT_FINAL:');
    expect(result).toContain('- Outcome: <implemented|already_completed>');
    expect(result).toContain('- Review iterations: <number>');
    expect(result).toContain('- Skill sequence proof:');
    expect(result).not.toContain('- Turn summary:');
  });

  it('builds execution continuation instructions when an open PR is inherited', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task'],
      continuationPrNumber: 1139,
      continuationPrBranch: 'task_existing_pr_branch',
    });

    expect(result).toContain('Existing PR: #1139');
    expect(result).toContain('Do NOT run `gh pr create`');
    expect(result).toContain('Do NOT open a second PR for this task');
    expect(result).toContain('git push origin HEAD:task_existing_pr_branch');
    expect(result).toContain('gh pr view 1139 --json url');
    expect(result).not.toContain('gh pr create --base development');
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

  it('builds pull request agent prompt when agentType is pull_request without pr-comment label', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['bug'],
      agentType: 'pull_request',
    });

    expect(result).toContain('[AGENT:PULL_REQUEST]');
    expect(result).toContain('[PULL REQUEST AGENT MODE]');
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

    expect(result).toContain('- Tracking comment: updated');
  });

  it('contains protocol violation language for skipping tracking comment', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('PROTOCOL VIOLATION');
    expect(result).toContain('no changes needed');
    expect(result).toContain('valid delivery outcome');
  });

  it('contains fixed Total PR comments posted value of 1', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('- Total PR comments posted: 1');
    expect(result).not.toContain('<must be exactly 1>');
  });

  it('reuses an existing tracking comment when trackingCommentId is provided', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
      trackingCommentId: '12345',
    });

    expect(result).toContain('A tracking comment already exists');
    expect(result).toContain('issues/comments/12345');
    expect(result).toContain('Do NOT post a new tracking comment');
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

  it('enforces zero-tolerance review loop in execution prompt', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('zero-tolerance loop');
    expect(result).toContain('ZERO issues');
    expect(result).toContain('no issue is too small to skip');
    expect(result).toContain('reviewer explicitly confirms no remaining issues');
    expect(result).toContain('fix + re-review cycle');
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

  it('includes Reading the Linear Issue section in planning prompt', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('### Reading the Linear Issue (MANDATORY PREREQUISITE');
    expect(result).toContain('mcp__linear__list_comments');
    expect(result).toContain('mcp__linear__get_issue');
    expect(result).toContain('NEWEST to OLDEST');
    expect(result).toContain('User clarifications');
  });

  it('includes Reading the Linear Issue section in execution prompt', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('### Reading the Linear Issue (MANDATORY FIRST ACTION');
    expect(result).toContain('mcp__linear__list_comments');
    expect(result).toContain('mcp__linear__get_issue');
    expect(result).toContain('NEWEST to OLDEST');
    expect(result).toContain('User clarifications');
  });

  it('includes Reading the Linear Issue section in pull request prompt', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('### Reading the Linear Issue (MANDATORY FIRST ACTION');
    expect(result).toContain('mcp__linear__list_comments');
    expect(result).toContain('mcp__linear__get_issue');
    expect(result).toContain('NEWEST to OLDEST');
    expect(result).toContain('User clarifications');
  });

  it('clarifies id vs identifier distinction in Reading the Linear Issue section for planning', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('UUID');
    expect(result).toContain('identifier');
  });

  it('clarifies id vs identifier distinction in Reading the Linear Issue section for execution', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('UUID');
    expect(result).toContain('identifier');
  });

  it('clarifies id vs identifier distinction in Reading the Linear Issue section for pull request', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('UUID');
    expect(result).toContain('identifier');
  });

  it('explains comments may contain user clarifications from previous runs for planning', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    expect(result).toContain('flagged as unclear');
    expect(result).toContain('clarifying answers');
  });

  it('explains comments may contain user clarifications from previous runs for execution', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('flagged as unclear');
    expect(result).toContain('clarifying answers');
  });

  it('explains comments may contain user clarifications from previous runs for pull request', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      linearIssueLabels: ['code-task', 'pr-comment'],
    });

    expect(result).toContain('flagged as unclear');
    expect(result).toContain('clarifying answers');
  });

  it('planning prompt Reading section is a prerequisite to Complexity Judgment, not competing first step', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

    // Reading section must appear before Complexity Judgment
    const readingIdx = result.indexOf('### Reading the Linear Issue');
    const judgmentIdx = result.indexOf('### Complexity Judgment');
    expect(readingIdx).toBeGreaterThan(-1);
    expect(judgmentIdx).toBeGreaterThan(-1);
    expect(readingIdx).toBeLessThan(judgmentIdx);

    // Reading section should use PREREQUISITE wording (not FIRST ACTION/FIRST STEP) in planning
    const planningReadingEnd = result.indexOf('### Planning Contract');
    const planningReadingSection = result.slice(readingIdx, planningReadingEnd);
    expect(planningReadingSection).toContain('MANDATORY PREREQUISITE');
    expect(planningReadingSection).toContain('prerequisite step');
    expect(planningReadingSection).toContain('Complexity Judgment');
  });

  it('builds review agent prompt with review markers and REVIEW_AGENT_FINAL', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).toContain('[AGENT:REVIEW]');
    expect(result).toContain('REVIEW_AGENT_FINAL:');
    expect(result).not.toContain('[AGENT:PLANNING]');
    expect(result).not.toContain('[AGENT:EXECUTION]');
    expect(result).not.toContain('[AGENT:PULL_REQUEST]');
  });

  it('review agent prompt does NOT include prReviewOverlayPrompt', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).not.toContain('[PR REVIEW MODE');
  });

  it('review agent prompt includes plan_review scope definition', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).toContain('plan_review');
    expect(result).toContain('Plan document validation');
    expect(result).toContain('task decomposition');
    expect(result).toContain('Do NOT review for code_quality/security/architecture');
  });

  it('review agent prompt includes PR analysis instructions', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).toContain('read-only');
    expect(result).toContain('gh api');
    expect(result).toContain('review');
  });

  it('review agent prompt includes review types and PR context fields', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).toContain('review_comments_posted');
    expect(result).toContain('review_types');
  });

  it('review agent prompt requires View in IntexuraOS link in review body when taskUrl is present', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
      taskUrl: 'https://intexuraos.cloud/#/code-tasks/task-123',
    });

    expect(result).toContain('Append a final standalone markdown link line exactly as:');
    expect(result).toContain(
      '[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/task-123)'
    );
    expect(result).toContain('not as a separate PR comment');
  });

  it('review agent prompt omits Linear section when linearIssueId is undefined', () => {
    const { linearIssueId: _, ...paramsWithoutLinear } = baseParams;
    const result = buildSystemPrompt({
      ...paramsWithoutLinear,
      agentType: 'review',
    });

    expect(result).not.toContain('MANDATORY FIRST ACTION');
    expect(result).not.toContain('mcp__linear__get_issue');
    expect(result).toContain('No Linear issue is associated');
    expect(result).toContain('[AGENT:REVIEW]');
  });

  describe('worker instruction sections (gh CLI, GCP credentials, code task debugging)', () => {
    function buildForLabel(label: string): string {
      switch (label) {
        case 'planning':
          return buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });
        case 'execution':
          return buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });
        case 'pull_request':
          return buildSystemPrompt({
            ...baseParams,
            linearIssueLabels: ['code-task', 'pr-comment'],
          });
        case 'review':
          return buildSystemPrompt({
            ...baseParams,
            linearIssueLabels: [],
            agentType: 'review',
          });
        default:
          throw new Error(`Unknown label: ${label}`);
      }
    }

    it.each(['planning', 'execution', 'pull_request', 'review'])(
      '%s prompt contains gh CLI preference section',
      (label) => {
        const result = buildForLabel(label);

        expect(result).toContain('### Git CLI (MANDATORY — NON-NEGOTIABLE)');
        expect(result).toContain('`gh` CLI instead of raw `git` commands');
      }
    );

    it.each(['planning', 'execution', 'pull_request', 'review'])(
      '%s prompt contains GCP service account credentials section',
      (label) => {
        const result = buildForLabel(label);

        expect(result).toContain('### GCP Service Account Credentials');
        expect(result).toContain('/secrets/gcp-sa.json');
      }
    );

    it.each(['planning', 'execution', 'pull_request', 'review'])(
      '%s prompt contains code task debugging rejection section',
      (label) => {
        const result = buildForLabel(label);

        expect(result).toContain('### Code Task Debugging (MANDATORY — NON-NEGOTIABLE)');
        expect(result).toContain('dev.intexuraos.cloud');
        expect(result).toContain('.claude/skills/debug-code-task/SKILL.md');
      }
    );

    it('does not duplicate worker instruction sections in overlay (planning+overlay)', () => {
      const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

      const ghCliCount = result.split('### Git CLI (MANDATORY').length - 1;
      const gcpCount = result.split('### GCP Service Account Credentials').length - 1;
      const debugCount = result.split('### Code Task Debugging (MANDATORY').length - 1;

      expect(ghCliCount).toBe(1);
      expect(gcpCount).toBe(1);
      expect(debugCount).toBe(1);
    });

    it('does not duplicate worker instruction sections in overlay (execution+overlay)', () => {
      const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

      const ghCliCount = result.split('### Git CLI (MANDATORY').length - 1;
      const gcpCount = result.split('### GCP Service Account Credentials').length - 1;
      const debugCount = result.split('### Code Task Debugging (MANDATORY').length - 1;

      expect(ghCliCount).toBe(1);
      expect(gcpCount).toBe(1);
      expect(debugCount).toBe(1);
    });
  });

  it('review agent prompt omits View in IntexuraOS review-body instruction when taskUrl is undefined', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).not.toContain('append a final standalone markdown link line exactly as:');
    expect(result).not.toContain('[View in IntexuraOS](');
  });

  it('review agent prompt requires posting review started comment as absolute first action', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).toContain('### Post Review Started Comment');
    expect(result).toContain('MANDATORY ABSOLUTE FIRST ACTION');
    expect(result).toContain('NON-NEGOTIABLE');
    expect(result).toContain('Review is now in progress');
  });

  it('review agent prompt requires review started comment before all other sections', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    const reviewStartedIdx = result.indexOf('### Post Review Started Comment');
    const reviewScopeIdx = result.indexOf('### Review Scope');
    const linearIdx = result.indexOf('### Reading the Linear Issue');
    const gatheringIdx = result.indexOf('### Gathering PR Context');

    expect(reviewStartedIdx).toBeGreaterThan(-1);
    expect(reviewStartedIdx).toBeLessThan(reviewScopeIdx);
    expect(reviewStartedIdx).toBeLessThan(linearIdx);
    expect(reviewStartedIdx).toBeLessThan(gatheringIdx);
  });

  it('review agent prompt includes requirements validation instructions', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).toContain('### Requirements Validation (MANDATORY');
    expect(result).toContain('Issue Requirements');
    expect(result).toContain('Requirements Coverage');
  });

  it('review agent prompt includes plan compliance hard gate instructions', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).toContain('### Plan Compliance (MANDATORY HARD GATE');
    expect(result).toContain('HARD GATE');
    expect(result).toContain('Plan Document');
  });

  it('review agent prompt has requirements validation before gathering PR context', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    const reqIdx = result.indexOf('### Requirements Validation');
    const planIdx = result.indexOf('### Plan Compliance');
    const gatherIdx = result.indexOf('### Gathering PR Context');

    expect(reqIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeGreaterThan(-1);
    expect(gatherIdx).toBeGreaterThan(-1);
    expect(reqIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(gatherIdx);
  });

  it('includes requirements tracker comment instructions', () => {
    const result = reviewPrompt.build(baseParams);
    expect(result).toContain('### Requirements Tracker Comment');
    expect(result).toContain('@ignore');
    expect(result).toContain('### Requirements Tracker');
    expect(result).toContain('PATCH');
  });

  it('includes all review type sections when reviewTypes is undefined', () => {
    const result = reviewPrompt.build(baseParams);
    expect(result).toContain('### Per-Type Review Structure (MANDATORY)');
    expect(result).toContain('🔍 Code Quality');
    expect(result).toContain('🔒 Security');
    expect(result).toContain('🏗️ Architecture');
    expect(result).toContain('📐 Plan Review');
    expect(result).toContain('Verdict:');
  });

  it('includes only requested review type sections when reviewTypes is specified', () => {
    const result = reviewPrompt.build({ ...baseParams, reviewTypes: ['code_quality', 'security'] });
    expect(result).toContain('### Per-Type Review Structure (MANDATORY)');
    expect(result).toContain('🔍 Code Quality');
    expect(result).toContain('🔒 Security');
    expect(result).not.toContain('🏗️ Architecture');
    expect(result).not.toContain('📐 Plan Review');
    expect(result).toContain('code_quality, security');
  });

  it('includes only architecture section when reviewTypes is ["architecture"]', () => {
    const result = reviewPrompt.build({ ...baseParams, reviewTypes: ['architecture'] });
    expect(result).toContain('🏗️ Architecture');
    expect(result).not.toContain('🔍 Code Quality');
    expect(result).not.toContain('🔒 Security');
    expect(result).not.toContain('📐 Plan Review');
  });

  it('includes only plan_review section when reviewTypes is ["plan_review"]', () => {
    const result = reviewPrompt.build({ ...baseParams, reviewTypes: ['plan_review'] });
    expect(result).toContain('📐 Plan Review');
    expect(result).not.toContain('🔍 Code Quality');
    expect(result).not.toContain('🔒 Security');
    expect(result).not.toContain('🏗️ Architecture');
  });

  it('omits Per-Type Review Structure section when all reviewTypes are unknown', () => {
    const result = reviewPrompt.build({ ...baseParams, reviewTypes: ['nonexistent_type'] });
    expect(result).not.toContain('### Per-Type Review Structure (MANDATORY)');
    expect(result).not.toContain('🔍 Code Quality');
    expect(result).not.toContain('🔒 Security');
    expect(result).not.toContain('🏗️ Architecture');
    expect(result).not.toContain('📐 Plan Review');
  });

  it('filters out unknown reviewTypes and includes only valid ones', () => {
    const result = reviewPrompt.build({
      ...baseParams,
      reviewTypes: ['nonexistent', 'security', 'also_invalid'],
    });
    expect(result).toContain('### Per-Type Review Structure (MANDATORY)');
    expect(result).toContain('🔒 Security');
    expect(result).not.toContain('🔍 Code Quality');
    expect(result).not.toContain('🏗️ Architecture');
    expect(result).not.toContain('📐 Plan Review');
  });

  it('REVIEW_AGENT_FINAL block includes requirements_tracker_updated field', () => {
    const result = reviewPrompt.build(baseParams);
    expect(result).toContain('requirements_tracker_updated');
    expect(result).toContain('REVIEW_AGENT_FINAL');
  });

  it('review agent prompt includes Linear section when linearIssueId is provided', () => {
    const result = buildSystemPrompt({
      ...baseParams,
      agentType: 'review',
    });

    expect(result).toContain('MANDATORY FIRST ACTION');
    expect(result).toContain('mcp__linear__get_issue');
    expect(result).toContain('INT-123');
  });

  it('review agent prompt includes GitHub Actions status check step', () => {
    const result = reviewPrompt.build(baseParams);
    expect(result).toContain('Check GitHub Actions Status');
    expect(result).toContain('gh pr checks');
    expect(result).toContain('bucket');
  });

  it('review agent prompt places GH Actions check between PR context and posting review', () => {
    const result = reviewPrompt.build(baseParams);
    const gatheringIndex = result.indexOf('Gathering PR Context');
    const ghActionsIndex = result.indexOf('Check GitHub Actions Status');
    const postingIndex = result.indexOf('Posting Review Comments');
    expect(gatheringIndex).toBeLessThan(ghActionsIndex);
    expect(ghActionsIndex).toBeLessThan(postingIndex);
  });

  it('review agent prompt includes GH Actions status in review structure template', () => {
    const result = reviewPrompt.build(baseParams);
    expect(result).toContain('GitHub Actions Status');
    expect(result).toContain('gh_actions_status');
  });

  it('REVIEW_AGENT_FINAL block includes gh_actions_status field', () => {
    const result = reviewPrompt.build(baseParams);
    expect(result).toContain('gh_actions_status');
    expect(result).toContain('REVIEW_AGENT_FINAL');
  });
});
