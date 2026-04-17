import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';

const {
  OrchestratorCompletionVerifier,
  PLANNING_SCHEMA,
  EXECUTION_SCHEMA,
  PULL_REQUEST_SCHEMA,
  REVIEW_SCHEMA,
  REMEDIATION_SCHEMA,
  RESUME_SUMMARY_SCHEMA,
  buildPlanningPrompt,
  buildExecutionPrompt,
  buildPullRequestPrompt,
  buildReviewPrompt,
  buildRemediationPrompt,
  buildResumeSummaryPrompt,
  getLast50Lines,
  getLast50ClaudeLines,
  getLast20Lines,
  detectFatalExitCode,
  getVerifierTaskId,
} = await import('../completion-verifier.js');

const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
const loggerDebug = vi.fn();

const logger: Logger = {
  info: loggerInfo as Logger['info'],
  warn: loggerWarn as Logger['warn'],
  error: loggerError as Logger['error'],
  debug: loggerDebug as Logger['debug'],
};

const generateMock = vi.fn();

function transcriptWithMeaningfulLines(label: string): string {
  return [
    '[orchestrator] starting',
    `[claude] ${label} line 1`,
    `[claude] ${label} line 2`,
    `[claude] ${label} line 3`,
    `[claude] ${label} line 4`,
    `[claude] ${label} line 5`,
  ].join('\n');
}

function createVerifier(
  overrides: Partial<{
    primaryModelName: string;
    fallbackClients: { generate: typeof generateMock }[];
    fallbackModelNames: string[];
  }> = {}
): InstanceType<typeof OrchestratorCompletionVerifier> {
  const base = {
    primaryClient: { generate: generateMock },
    fallbackClients: overrides.fallbackClients ?? [],
    primaryModelName: overrides.primaryModelName ?? 'or:google/gemma-4-31b-it:free',
  };
  return new OrchestratorCompletionVerifier(
    logger,
    overrides.fallbackModelNames !== undefined
      ? { ...base, fallbackModelNames: overrides.fallbackModelNames }
      : base
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  generateMock.mockReset();
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

describe('PLANNING_SCHEMA', () => {
  it('accepts valid planning data', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-100',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
      summary: 'Planned the task.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts unclear outcome with clarification message', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'unclear',
      superpowers_writing_plans: 'not used',
      linear_url: '',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'Could not plan.',
      unclear_clarification: 'Need more info.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts planned outcome with pr_url', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-631',
      is_complex: '1',
      has_plan_doc: '1',
      subtask_urls: '',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/950',
      summary: 'Planned and created PR.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts complex task with populated subtask_urls', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-631',
      is_complex: '1',
      has_plan_doc: '1',
      subtask_urls:
        'https://linear.app/pbuchman/issue/INT-632/subtask-one,https://linear.app/pbuchman/issue/INT-633/subtask-two',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/631',
      summary: 'Planned with subtasks.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtask_urls).toBe(
        'https://linear.app/pbuchman/issue/INT-632/subtask-one,https://linear.app/pbuchman/issue/INT-633/subtask-two'
      );
    }
  });

  it('accepts plan-doc task with has_plan_doc=1 and is_complex=0', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-700',
      is_complex: '0',
      has_plan_doc: '1',
      subtask_urls: '',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/960',
      summary: 'Plan-doc task planned.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.has_plan_doc).toBe('1');
      expect(result.data.is_complex).toBe('0');
    }
  });

  it('accepts simple task with empty subtask_urls', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'not used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-640',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/640',
      summary: 'Simple task planned.',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtask_urls).toBe('');
    }
  });

  it('rejects invalid outcome', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'done',
      superpowers_writing_plans: 'used',
      linear_url: '',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'x',
      unclear_clarification: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = PLANNING_SCHEMA.safeParse({ outcome: 'planned' });
    expect(result.success).toBe(false);
  });

  it('rejects empty pr_url when outcome is planned', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-100/test',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'test',
      unclear_clarification: '',
    });
    expect(result.success).toBe(false);
  });

  it('allows empty pr_url when outcome is unclear', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'unclear',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-100/test',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'test',
      unclear_clarification: 'Not enough info',
    });
    expect(result.success).toBe(true);
  });

  it('accepts memory reporting fields for planning tasks', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-100/test',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/101',
      memory_ids_used: 'mem_142',
      memory_ids_rejected: 'mem_188',
      memory_usage_summary: 'Used the prior planning memory to keep the plan aligned.',
      summary: 'test',
      unclear_clarification: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('EXECUTION_SCHEMA', () => {
  it('accepts valid execution data', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      outcome: 'implemented',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'not used',
      gh_pr_url: 'https://github.com/org/repo/pull/1',
      memory_ids_used: 'MEM-142,MEM-155',
      memory_ids_rejected: 'MEM-188',
      memory_usage_summary: 'Used route logging and route coverage lessons.',
      summary: 'Implemented the feature.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid enum value', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      superpowers_subagent_driven_dev: 'maybe',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: '',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty gh_pr_url when outcome is implemented', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      outcome: 'implemented',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: '',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty gh_pr_url when outcome is already_completed', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      outcome: 'already_completed',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'not used',
      gh_pr_url: '',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts non-empty gh_pr_url when outcome is already_completed', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      outcome: 'already_completed',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'not used',
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 'Evidence PR for already-completed work.',
    });
    expect(result.success).toBe(true);
  });
});

describe('PULL_REQUEST_SCHEMA', () => {
  it('accepts valid pull request data', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      tracking_comment_id: '12345678',
      summary: 'Addressed review comments.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid comments_replied value', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: '',
      comments_replied: 'maybe',
      tracking_comment_id: '12345678',
      summary: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty tracking_comment_id', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      tracking_comment_id: '',
      summary: 'Addressed review comments.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing tracking_comment_id', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      summary: 'Addressed review comments.',
    });
    expect(result.success).toBe(false);
  });

  it('accepts memory reporting fields for pull request tasks', () => {
    const result = PULL_REQUEST_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      tracking_comment_id: '12345678',
      memory_ids_used: 'mem_142',
      memory_ids_rejected: 'mem_188',
      memory_usage_summary: 'Used the review-thread memory to keep replies consistent.',
      summary: 'Addressed review comments.',
    });
    expect(result.success).toBe(true);
  });
});

describe('REVIEW_SCHEMA', () => {
  it('accepts valid review data', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '123',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Reviewed the PR for code quality and security issues.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts memory reporting fields for review tasks', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '123',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      memory_ids_used: 'mem_142',
      memory_ids_rejected: 'mem_188',
      memory_usage_summary: 'Used the injected review memories to focus the findings.',
      summary: 'Reviewed the PR for code quality and security issues.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts review data when review_id is omitted', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Reviewed the PR for code quality and security issues.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts review data when review_id is empty string', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Reviewed the PR for code quality and security issues.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-empty non-numeric review_id', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: 'not-a-number',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Reviewed the PR for code quality and security issues.',
    });
    expect(result.success).toBe(false);
  });

  it('accepts review_comments_posted as numeric string', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '123',
      review_comments_posted: '0',
      review_types: 'code_quality',
      summary: 'No issues found.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty review_comments_posted', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '123',
      review_comments_posted: '',
      review_types: 'code_quality',
      summary: 'Reviewed.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric review_comments_posted', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '123',
      review_comments_posted: 'three',
      review_types: 'code_quality',
      summary: 'Reviewed.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty review_types', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '123',
      review_comments_posted: '3',
      review_types: '',
      summary: 'Reviewed.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only review_types', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '123',
      review_comments_posted: '3',
      review_types: '   ',
      summary: 'Reviewed.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
    });
    expect(result.success).toBe(false);
  });

  it('accepts requirements_tracker_updated field', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/901',
      review_id: '123',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      requirements_tracker_updated: 'yes',
      summary: 'Review summary.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty requirements_tracker_updated', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/901',
      review_id: '123',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      requirements_tracker_updated: '',
      summary: 'Review summary.',
    });
    expect(result.success).toBe(true);
  });

  it('defaults requirements_tracker_updated to empty string when omitted', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/901',
      review_id: '123',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Review summary.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirements_tracker_updated).toBe('');
    }
  });

  it('accepts gh_actions_status field', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/901',
      review_id: '123',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      gh_actions_status: 'all checks passed',
      summary: 'Review summary.',
    });
    expect(result.success).toBe(true);
  });

  it('defaults gh_actions_status to empty string when omitted', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/901',
      review_id: '123',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Review summary.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gh_actions_status).toBe('');
    }
  });
});

describe('REMEDIATION_SCHEMA', () => {
  it('rejects empty gh_pr_url when outcome is implemented', () => {
    const result = REMEDIATION_SCHEMA.safeParse({
      outcome: 'implemented',
      gh_pr_url: '',
      requires_re_review: '0',
      summary: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('allows empty gh_pr_url when outcome is already_completed', () => {
    const result = REMEDIATION_SCHEMA.safeParse({
      outcome: 'already_completed',
      gh_pr_url: '',
      requires_re_review: '0',
      summary: 'test',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid remediation data with gh_pr_url', () => {
    const result = REMEDIATION_SCHEMA.safeParse({
      outcome: 'implemented',
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/901',
      memory_ids_used: 'mem_142',
      memory_ids_rejected: 'mem_188',
      memory_usage_summary: 'Used remediation memories to stay within PR scope.',
      requires_re_review: '1',
      summary: 'Fixed review findings.',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt', () => {
  it('includes transcript and planning-specific fields', () => {
    const prompt = buildPlanningPrompt('line1\nline2');
    expect(prompt).toContain('Planning Agent');
    expect(prompt).toContain('outcome');
    expect(prompt).toContain('superpowers_writing_plans');
    expect(prompt).toContain('linear_url');
    expect(prompt).toContain('is_complex');
    expect(prompt).toContain('has_plan_doc');
    expect(prompt).toContain('subtask_urls');
    expect(prompt).toContain('pr_url');
    expect(prompt).toContain('unclear_clarification');
    expect(prompt).toContain('line1\nline2');
  });

  it('includes shared preamble instructions', () => {
    const prompt = buildPlanningPrompt('transcript');
    expect(prompt).toContain('Analyze the transcript from the END toward the beginning');
    expect(prompt).toContain('most recent output takes priority');
    expect(prompt).toContain(
      'LLM agent delivers its summary in one of the last assistant messages'
    );
    expect(prompt).toContain('Linear URL format example');
    expect(prompt).toContain('GitHub PR URL format example');
  });
});

describe('buildExecutionPrompt', () => {
  it('includes transcript and execution-specific fields', () => {
    const prompt = buildExecutionPrompt('exec-log');
    expect(prompt).toContain('Execution Agent');
    expect(prompt).toContain('superpowers_subagent_driven_dev');
    expect(prompt).toContain('superpowers_requesting_code_review');
    expect(prompt).toContain('gh_pr_url');
    expect(prompt).toContain('memory_ids_used');
    expect(prompt).toContain('memory_ids_rejected');
    expect(prompt).toContain('memory_usage_summary');
    expect(prompt).toContain('exec-log');
  });

  it('includes shared preamble instructions', () => {
    const prompt = buildExecutionPrompt('transcript');
    expect(prompt).toContain('Analyze the transcript from the END toward the beginning');
    expect(prompt).toContain(
      'LLM agent delivers its summary in one of the last assistant messages'
    );
  });

  it('marks gh_pr_url as REQUIRED for all outcomes', () => {
    const prompt = buildExecutionPrompt('exec-log');
    expect(prompt).toContain('REQUIRED for all execution outcomes');
    expect(prompt).not.toContain('"gh_pr_url":""');
  });
});

describe('buildPullRequestPrompt', () => {
  it('includes transcript and pull-request-specific fields', () => {
    const prompt = buildPullRequestPrompt('pr-log');
    expect(prompt).toContain('Pull Request Agent');
    expect(prompt).toContain('gh_pr_url');
    expect(prompt).toContain('comments_replied');
    expect(prompt).toContain('tracking_comment_id');
    expect(prompt).toContain('pr-log');
  });

  it('includes shared preamble instructions', () => {
    const prompt = buildPullRequestPrompt('transcript');
    expect(prompt).toContain('Analyze the transcript from the END toward the beginning');
    expect(prompt).toContain(
      'LLM agent delivers its summary in one of the last assistant messages'
    );
  });
});

describe('buildReviewPrompt', () => {
  it('includes transcript and review-specific fields', () => {
    const prompt = buildReviewPrompt('review-log');
    expect(prompt).toContain('Review Agent');
    expect(prompt).toContain('gh_pr_url');
    expect(prompt).toContain('review_comments_posted');
    expect(prompt).toContain('review_types');
    expect(prompt).toContain('requirements_tracker_updated');
    expect(prompt).toContain('review-log');
  });

  it('includes shared preamble instructions', () => {
    const prompt = buildReviewPrompt('transcript');
    expect(prompt).toContain('Analyze the transcript from the END toward the beginning');
    expect(prompt).toContain(
      'LLM agent delivers its summary in one of the last assistant messages'
    );
  });

  it('needs_remediation definition excludes operational/manual verification steps', () => {
    const prompt = buildReviewPrompt('transcript');
    expect(prompt).toContain('post-merge activities');
    expect(prompt).toContain('do NOT count as code remediation');
  });
});

// ---------------------------------------------------------------------------
// getLast50Lines
// ---------------------------------------------------------------------------

describe('getLast50Lines', () => {
  it('returns last 50 lines from raw logs', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${String(i + 1)}`);
    const result = getLast50Lines(lines.join('\n'));
    const resultLines = result.split('\n');
    expect(resultLines).toHaveLength(50);
    expect(resultLines[0]).toBe('line-51');
    expect(resultLines[49]).toBe('line-100');
  });

  it('returns all lines when fewer than 50', () => {
    const result = getLast50Lines('a\nb\nc');
    expect(result).toBe('a\nb\nc');
  });

  it('returns empty string for empty input', () => {
    const result = getLast50Lines('');
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getLast50ClaudeLines
// ---------------------------------------------------------------------------

describe('getLast50ClaudeLines', () => {
  it('filters to only [claude]-tagged lines and returns last 50', () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? `[claude] line-${String(i + 1)}` : `[system] line-${String(i + 1)}`
    );
    const result = getLast50ClaudeLines(lines.join('\n'));
    const resultLines = result.split('\n');
    // Only 50 [claude] lines (every even index from 100 total)
    expect(resultLines).toHaveLength(50);
    // All 50 [claude] lines are returned (50 or fewer filtered, so all included)
    expect(resultLines[0]).toBe('[claude] line-1'); // First [claude] line
    expect(resultLines[49]).toBe('[claude] line-99'); // Last [claude] line
  });

  it('returns all [claude] lines when fewer than 50', () => {
    const result = getLast50ClaudeLines(
      `[system] noise\n[claude] hello\n[system] noise\n[claude] world`
    );
    expect(result).toBe('[claude] hello\n[claude] world');
  });

  it('truncates to last 50 [claude] lines when more than 50 exist', () => {
    // Create 55 [claude] lines (more than 50) mixed with system lines
    const lines: string[] = [];
    for (let i = 0; i < 110; i++) {
      if (i % 2 === 0) {
        lines.push(`[claude] line-${String(i + 1)}`);
      } else {
        lines.push(`[system] line-${String(i + 1)}`);
      }
    }
    const result = getLast50ClaudeLines(lines.join('\n'));
    const resultLines = result.split('\n');
    // 110 total lines, 55 are [claude] (every even index), slice(-50) returns last 50
    expect(resultLines).toHaveLength(50);
    // First returned should be the 6th [claude] line (line-11, slice(-50) skips first 5 of 55)
    expect(resultLines[0]).toBe('[claude] line-11');
    // Last returned should be the 55th [claude] line (line-109)
    expect(resultLines[49]).toBe('[claude] line-109');
  });

  it('returns empty string when no [claude] lines', () => {
    const result = getLast50ClaudeLines('[system] noise\n[system] more');
    expect(result).toBe('');
  });

  it('returns empty string for empty input', () => {
    const result = getLast50ClaudeLines('');
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// OrchestratorCompletionVerifier — constructor
// ---------------------------------------------------------------------------

describe('OrchestratorCompletionVerifier', () => {
  describe('describe', () => {
    it('returns enabled with primary model name', () => {
      const verifier = createVerifier({ primaryModelName: 'or:google/gemma-4-31b-it:free' });
      expect(verifier.describe()).toEqual({
        enabled: true,
        model: 'or:google/gemma-4-31b-it:free',
      });
    });
  });

  describe('fallback behavior', () => {
    it('uses fallback client when primary fails', async () => {
      const fallbackGenerate = vi.fn();
      generateMock.mockResolvedValueOnce({
        ok: false as const,
        error: { code: 'API_ERROR', message: 'Primary failed' },
      });
      fallbackGenerate.mockResolvedValueOnce({
        ok: true as const,
        value: {
          content: JSON.stringify({
            outcome: 'planned',
            superpowers_writing_plans: 'used',
            linear_url: 'https://linear.app/pbuchman/issue/INT-100',
            is_complex: '0',
            has_plan_doc: '0',
            subtask_urls: '',
            pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
            summary: 'The agent planned successfully.',
            unclear_clarification: '',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier({
        fallbackClients: [{ generate: fallbackGenerate }],
        fallbackModelNames: ['or:meta-llama/llama-4-scout:free'],
      });

      const result = await verifier.verify({
        taskId: 'task-fallback-test',
        attempt: 1,
        maxAttempts: 1,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('test'),
      });

      expect(result.passed).toBe(true);
      expect(fallbackGenerate).toHaveBeenCalledTimes(1);
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'or:google/gemma-4-31b-it:free' }),
        'Completion verifier model call failed, trying next'
      );
      // The response log must name the fallback model, not the primary
      expect(loggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'or:meta-llama/llama-4-scout:free' }),
        'Completion verifier response'
      );
    });

    it('returns verifierFailure when all clients fail', async () => {
      const fallbackGenerate = vi.fn();
      generateMock.mockResolvedValueOnce({
        ok: false as const,
        error: { code: 'API_ERROR', message: 'Primary failed' },
      });
      fallbackGenerate.mockResolvedValueOnce({
        ok: false as const,
        error: { code: 'API_ERROR', message: 'Fallback also failed' },
      });
      const verifier = createVerifier({
        fallbackClients: [{ generate: fallbackGenerate }],
      });

      const result = await verifier.verify({
        taskId: 'task-all-fail-test',
        attempt: 1,
        maxAttempts: 1,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('test'),
      });

      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(true);
    });

    it('uses fallback when primary returns unparseable JSON', async () => {
      const fallbackGenerate = vi.fn();
      generateMock.mockResolvedValueOnce({
        ok: true as const,
        value: {
          content: 'not valid json',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      fallbackGenerate.mockResolvedValueOnce({
        ok: true as const,
        value: {
          content: JSON.stringify({
            outcome: 'planned',
            superpowers_writing_plans: 'used',
            linear_url: 'https://linear.app/pbuchman/issue/INT-200',
            is_complex: '0',
            has_plan_doc: '0',
            subtask_urls: '',
            pr_url: 'https://github.com/pbuchman/intexuraos/pull/200',
            summary: 'Fallback parsed.',
            unclear_clarification: '',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier({
        fallbackClients: [{ generate: fallbackGenerate }],
        fallbackModelNames: ['or:meta-llama/llama-4-scout:free'],
      });

      const result = await verifier.verify({
        taskId: 'task-parse-fallback',
        attempt: 1,
        maxAttempts: 1,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('test'),
      });

      expect(result.passed).toBe(true);
      expect(fallbackGenerate).toHaveBeenCalledTimes(1);
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'or:google/gemma-4-31b-it:free' }),
        'Completion verifier response parsing failed, trying next model'
      );
    });

    it('uses fallback when primary fails schema validation', async () => {
      const fallbackGenerate = vi.fn();
      // Primary returns valid JSON but incomplete schema for pull_request agent
      generateMock.mockResolvedValueOnce({
        ok: true as const,
        value: {
          content: JSON.stringify({ gh_pr_url: 'https://github.com/org/repo/pull/1' }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      // Fallback returns valid complete response for planning agent
      fallbackGenerate.mockResolvedValueOnce({
        ok: true as const,
        value: {
          content: JSON.stringify({
            outcome: 'planned',
            superpowers_writing_plans: 'used',
            linear_url: 'https://linear.app/pbuchman/issue/INT-300',
            is_complex: '0',
            has_plan_doc: '0',
            subtask_urls: '',
            pr_url: 'https://github.com/pbuchman/intexuraos/pull/300',
            summary: 'Fallback validated.',
            unclear_clarification: '',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier({
        fallbackClients: [{ generate: fallbackGenerate }],
        fallbackModelNames: ['or:meta-llama/llama-4-scout:free'],
      });

      const result = await verifier.verify({
        taskId: 'task-schema-fallback',
        attempt: 1,
        maxAttempts: 1,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('test'),
      });

      expect(result.passed).toBe(true);
      expect(fallbackGenerate).toHaveBeenCalledTimes(1);
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'or:google/gemma-4-31b-it:free' }),
        'Completion verifier Zod validation failed, trying next model'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // verify — planning agent
  // ---------------------------------------------------------------------------

  describe('verify — planning agent', () => {
    const validPlanningResponse = JSON.stringify({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-100',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
      summary: 'The agent planned successfully.',
      unclear_clarification: '',
    });

    it('returns passed with agentData on valid response', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validPlanningResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-1',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('plan'),
      });
      expect(result.passed).toBe(true);
      expect(result.verifierFailure).toBe(false);
      expect(result.missingFields).toEqual([]);
      expect(result.agentData).toEqual({
        agentType: 'planning',
        outcome: 'planned',
        superpowers_writing_plans: 'used',
        linear_url: 'https://linear.app/pbuchman/issue/INT-100',
        is_complex: '0',
        has_plan_doc: '0',
        subtask_urls: '',
        pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
        memory_ids_used: '',
        memory_ids_rejected: '',
        memory_usage_summary: '',
        summary: 'The agent planned successfully.',
        unclear_clarification: '',
      });
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: validPlanningResponse,
      });
    });

    it('returns passed for unclear outcome', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'unclear',
            superpowers_writing_plans: 'not used',
            linear_url: '',
            is_complex: '0',
            has_plan_doc: '0',
            subtask_urls: '',
            pr_url: '',
            summary: 'Could not plan.',
            unclear_clarification: 'Need info about auth approach.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-1',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('generic'),
      });
      expect(result.passed).toBe(true);
      expect(result.agentData?.agentType).toBe('planning');
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: expect.any(String),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify — execution agent
  // ---------------------------------------------------------------------------

  describe('verify — execution agent', () => {
    const validExecutionResponse = JSON.stringify({
      outcome: 'implemented',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: 'https://github.com/org/repo/pull/901',
      memory_ids_used: 'mem_142,mem_155',
      memory_ids_rejected: 'mem_188',
      memory_usage_summary: 'Used route logging and coverage lessons.',
      summary: 'Implemented the feature.',
    });

    it('returns passed with execution agentData', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validExecutionResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-2',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: transcriptWithMeaningfulLines('exec'),
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'execution',
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/901',
        memory_ids_used: 'mem_142,mem_155',
        memory_ids_rejected: 'mem_188',
        memory_usage_summary: 'Used route logging and coverage lessons.',
        summary: 'Implemented the feature.',
      });
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: validExecutionResponse,
      });
    });

    it('fails when injected memories are not acknowledged or reported with valid ids', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'implemented',
            superpowers_subagent_driven_dev: 'used',
            superpowers_requesting_code_review: 'used',
            gh_pr_url: 'https://github.com/org/repo/pull/901',
            memory_ids_used: 'mem_142,mem_unknown',
            memory_ids_rejected: '',
            memory_usage_summary: '',
            summary: 'Implemented the feature.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-memory-enforcement',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs:
          '[claude] Work started\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] Finished without memory block\n',
        executionMemoryContext: {
          applicationId: 'app-123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Route logging',
          matchedMemories: [
            {
              memoryId: 'mem_142',
              title: 'Route logging',
              memoryType: 'pitfall_pattern',
              score: 0.94,
              appliesWhen: 'Callback route changes',
              action: 'Update request logging',
              avoid: 'Do not use stale branches',
              verification: 'Add route coverage',
            },
            {
              memoryId: 'mem_155',
              title: 'Route coverage',
              memoryType: 'verification_pattern',
              score: 0.92,
              appliesWhen: 'Route schema work',
              action: 'Add app.inject coverage',
              avoid: 'Do not skip serialization checks',
              verification: 'Verify response body',
            },
          ],
        },
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual(
        expect.arrayContaining([
          'memory_acknowledgment',
          'memory_ids_used_invalid',
          'memory_usage_summary',
        ])
      );
    });

    it('fails when rejected ids are invalid, overlap with used ids, or leave memories unaccounted', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'implemented',
            superpowers_subagent_driven_dev: 'used',
            superpowers_requesting_code_review: 'used',
            gh_pr_url: 'https://github.com/org/repo/pull/901',
            memory_ids_used: 'mem_142',
            memory_ids_rejected: 'mem_142,mem_unknown',
            memory_usage_summary: 'Used one memory and rejected the rest.',
            summary: 'Implemented the feature.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-memory-overlap',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: [
          '[claude] 📋 **Execution Memories Received:**',
          '[claude] - [mem_142] Route logging',
          '[claude] - [mem_155] Route coverage',
          '[claude] started work',
          '[claude] finished work',
        ].join('\n'),
        executionMemoryContext: {
          applicationId: 'app-123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Route logging',
          matchedMemories: [
            {
              memoryId: 'mem_142',
              title: 'Route logging',
              memoryType: 'pitfall_pattern',
              score: 0.94,
              appliesWhen: 'Callback route changes',
              action: 'Update request logging',
              avoid: 'Do not use stale branches',
              verification: 'Add route coverage',
            },
            {
              memoryId: 'mem_155',
              title: 'Route coverage',
              memoryType: 'verification_pattern',
              score: 0.92,
              appliesWhen: 'Route schema work',
              action: 'Add app.inject coverage',
              avoid: 'Do not skip serialization checks',
              verification: 'Verify response body',
            },
          ],
        },
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual(
        expect.arrayContaining([
          'memory_ids_rejected_invalid',
          'memory_ids_overlap',
          'memory_ids_unaccounted',
        ])
      );
    });

    it('skips memory validation when no memories were injected', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validExecutionResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-no-injected-memories',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs:
          '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] Finished without memory block\n',
        executionMemoryContext: {
          applicationId: 'app-123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Route logging',
          matchedMemories: [],
        },
      });
      expect(result.passed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // verify — pull_request agent
  // ---------------------------------------------------------------------------

  describe('verify — pull_request agent', () => {
    const validPRResponse = JSON.stringify({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      comments_replied: 'yes',
      tracking_comment_id: '2345678',
      summary: 'Addressed review comments.',
    });

    it('returns passed with pull_request agentData', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validPRResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-3',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'pull_request',
        rawLogs: transcriptWithMeaningfulLines('pr'),
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'pull_request',
        gh_pr_url: 'https://github.com/org/repo/pull/42',
        comments_replied: 'yes',
        tracking_comment_id: '2345678',
        memory_ids_used: '',
        memory_ids_rejected: '',
        memory_usage_summary: '',
        summary: 'Addressed review comments.',
      });
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: validPRResponse,
      });
    });

    it('returns passed with shared memory reporting for pull request tasks', async () => {
      const response = JSON.stringify({
        gh_pr_url: 'https://github.com/org/repo/pull/42',
        comments_replied: 'yes',
        tracking_comment_id: '2345678',
        memory_ids_used: 'mem_142',
        memory_ids_rejected: '',
        memory_usage_summary: 'Used the injected memory to keep PR replies aligned.',
        summary: 'Addressed review comments.',
      });
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: response,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-pr-memory',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'pull_request',
        rawLogs:
          '[claude] 📋 **Execution Memories Received:**\n[claude] - [mem_142] PR reply pattern\n[claude] step 1\n[claude] step 2\n[claude] done\n',
        executionMemoryContext: {
          applicationId: 'app-123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'PR review replies',
          matchedMemories: [
            {
              memoryId: 'mem_142',
              title: 'PR reply pattern',
              memoryType: 'review_finding',
              score: 0.9,
              appliesWhen: 'Responding to review comments',
              action: 'Reply in thread with concrete changes',
              avoid: 'Do not post top-level replies for inline comments',
              verification: 'Check the review thread',
            },
          ],
        },
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'pull_request',
        gh_pr_url: 'https://github.com/org/repo/pull/42',
        comments_replied: 'yes',
        tracking_comment_id: '2345678',
        memory_ids_used: 'mem_142',
        memory_ids_rejected: '',
        memory_usage_summary: 'Used the injected memory to keep PR replies aligned.',
        summary: 'Addressed review comments.',
      });
    });
  });

  describe('verify — review agent', () => {
    const validReviewResponse = JSON.stringify({
      gh_pr_url: 'https://github.com/org/repo/pull/42',
      review_id: '123',
      review_comments_posted: '3',
      review_types: 'code_quality,security',
      summary: 'Reviewed and posted 3 comments.',
    });

    it('returns passed with review agentData (not pull_request)', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validReviewResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-4',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'review',
        rawLogs: transcriptWithMeaningfulLines('review'),
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'review',
        gh_pr_url: 'https://github.com/org/repo/pull/42',
        review_id: '123',
        review_comments_posted: '3',
        review_types: 'code_quality,security',
        memory_ids_used: '',
        memory_ids_rejected: '',
        memory_usage_summary: '',
        requirements_tracker_updated: '',
        gh_actions_status: '',
        needs_remediation: '1',
        review_body: '',
        review_inline_comments: '',
        summary: 'Reviewed and posted 3 comments.',
      });
    });

    it('returns passed when review agent response omits review_id', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            gh_pr_url: 'https://github.com/org/repo/pull/42',
            review_comments_posted: '3',
            review_types: 'code_quality,security',
            summary: 'Reviewed and posted 3 comments.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-4b',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'review',
        rawLogs: transcriptWithMeaningfulLines('review'),
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'review',
        gh_pr_url: 'https://github.com/org/repo/pull/42',
        review_comments_posted: '3',
        review_types: 'code_quality,security',
        memory_ids_used: '',
        memory_ids_rejected: '',
        memory_usage_summary: '',
        requirements_tracker_updated: '',
        gh_actions_status: '',
        needs_remediation: '1',
        review_body: '',
        review_inline_comments: '',
        summary: 'Reviewed and posted 3 comments.',
      });
    });
  });

  describe('verify — remediation agent', () => {
    const validRemediationResponse = JSON.stringify({
      outcome: 'implemented',
      gh_pr_url: 'https://github.com/org/repo/pull/77',
      requires_re_review: '0',
      summary: 'Fixed the reported review findings and pushed to the PR branch.',
    });

    it('returns passed with remediation agentData', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validRemediationResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-5',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'remediation',
        rawLogs: transcriptWithMeaningfulLines('remediation'),
      });
      expect(result.passed).toBe(true);
      expect(result.agentData).toEqual({
        agentType: 'remediation',
        outcome: 'implemented',
        gh_pr_url: 'https://github.com/org/repo/pull/77',
        memory_ids_used: '',
        memory_ids_rejected: '',
        memory_usage_summary: '',
        requires_re_review: '0',
        summary: 'Fixed the reported review findings and pushed to the PR branch.',
      });
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: validRemediationResponse,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify — memory field enforcement for non-execution agents
  // ---------------------------------------------------------------------------

  describe('verify — memory field enforcement for non-execution agents', () => {
    const makeMemoryContext = (memoryIds: string[]): ExecutionMemoryPromptContext => ({
      applicationId: 'app-123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Test query',
      matchedMemories: memoryIds.map((memoryId) => ({
        memoryId,
        title: `Memory ${memoryId}`,
        memoryType: 'pitfall_pattern' as const,
        score: 0.9,
        appliesWhen: 'When working on feature',
        action: 'Follow the pattern',
        avoid: 'Do not skip',
        verification: 'Check after done',
      })),
    });

    it('fails planning agent when memories were injected but memory_ids_used and memory_ids_rejected are both empty', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'planned',
            superpowers_writing_plans: 'used',
            linear_url: 'https://linear.app/pbuchman/issue/INT-100',
            is_complex: '0',
            has_plan_doc: '0',
            subtask_urls: '',
            pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
            memory_ids_used: '',
            memory_ids_rejected: '',
            memory_usage_summary: '',
            summary: 'Planned.',
            unclear_clarification: '',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-planning-memory-empty',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs:
          '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] Planning completed',
        executionMemoryContext: makeMemoryContext(['mem_142']),
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(false);
      expect(result.missingFields).toEqual(['memory_ids_used', 'memory_ids_rejected']);
    });

    it('passes planning agent when only memory_ids_used is populated (rejected empty is acceptable)', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'planned',
            superpowers_writing_plans: 'used',
            linear_url: 'https://linear.app/pbuchman/issue/INT-100',
            is_complex: '0',
            has_plan_doc: '0',
            subtask_urls: '',
            pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
            memory_ids_used: 'mem_142',
            memory_ids_rejected: '',
            memory_usage_summary: 'Used memory to improve the plan.',
            summary: 'Planned.',
            unclear_clarification: '',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      // Note: validateMemoryReporting will still run and may fail for unaccounted IDs etc.,
      // but the post-parse empty-field check won't trigger since memory_ids_used is non-empty.
      // For this test we inject mem_142 and report mem_142 as used — should pass all validation.
      const result = await verifier.verify({
        taskId: 'task-planning-memory-used',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs:
          '[claude] 📋 **Execution Memories Received:**\n[claude] - [mem_142] Memory for planning\n[claude] step 1\n[claude] step 2\n[claude] done\n',
        executionMemoryContext: makeMemoryContext(['mem_142']),
      });
      expect(result.passed).toBe(true);
    });

    it('passes planning agent when only memory_ids_rejected is populated (used empty is acceptable)', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'planned',
            superpowers_writing_plans: 'used',
            linear_url: 'https://linear.app/pbuchman/issue/INT-100',
            is_complex: '0',
            has_plan_doc: '0',
            subtask_urls: '',
            pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
            memory_ids_used: '',
            memory_ids_rejected: 'mem_142',
            memory_usage_summary: 'Rejected the memory as not applicable.',
            summary: 'Planned.',
            unclear_clarification: '',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-planning-memory-rejected',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs:
          '[claude] 📋 **Execution Memories Received:**\n[claude] - [mem_142] Memory for planning\n[claude] step 1\n[claude] step 2\n[claude] done\n',
        executionMemoryContext: makeMemoryContext(['mem_142']),
      });
      expect(result.passed).toBe(true);
    });

    it('fails pull_request agent when memories were injected but both memory fields are empty', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            gh_pr_url: 'https://github.com/org/repo/pull/42',
            comments_replied: 'yes',
            tracking_comment_id: '12345678',
            memory_ids_used: '',
            memory_ids_rejected: '',
            memory_usage_summary: '',
            summary: 'Replied to PR comments.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-pr-memory-empty',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'pull_request',
        rawLogs:
          '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] PR work done',
        executionMemoryContext: makeMemoryContext(['mem_200']),
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(false);
      expect(result.missingFields).toEqual(['memory_ids_used', 'memory_ids_rejected']);
    });

    it('fails review agent when memories were injected but both memory fields are empty', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            gh_pr_url: 'https://github.com/org/repo/pull/42',
            review_id: '123',
            review_comments_posted: '2',
            review_types: 'code_quality',
            memory_ids_used: '',
            memory_ids_rejected: '',
            memory_usage_summary: '',
            summary: 'Reviewed the PR.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-review-memory-empty',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'review',
        rawLogs:
          '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] Review done',
        executionMemoryContext: makeMemoryContext(['mem_300']),
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(false);
      expect(result.missingFields).toEqual(['memory_ids_used', 'memory_ids_rejected']);
    });

    it('fails remediation agent when memories were injected but both memory fields are empty', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'implemented',
            gh_pr_url: 'https://github.com/org/repo/pull/77',
            memory_ids_used: '',
            memory_ids_rejected: '',
            memory_usage_summary: '',
            requires_re_review: '0',
            summary: 'Remediated the review findings.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-remediation-memory-empty',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'remediation',
        rawLogs:
          '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] Remediation done',
        executionMemoryContext: makeMemoryContext(['mem_400']),
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(false);
      expect(result.missingFields).toEqual(['memory_ids_used', 'memory_ids_rejected']);
    });

    it('skips memory field enforcement for non-execution agents when no memories were injected', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            gh_pr_url: 'https://github.com/org/repo/pull/42',
            review_id: '123',
            review_comments_posted: '2',
            review_types: 'code_quality',
            memory_ids_used: '',
            memory_ids_rejected: '',
            memory_usage_summary: '',
            summary: 'Reviewed the PR.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-review-no-memories',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'review',
        rawLogs:
          '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] Review done',
        executionMemoryContext: {
          applicationId: 'app-123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Test query',
          matchedMemories: [],
        },
      });
      expect(result.passed).toBe(true);
    });

    it('skips memory field enforcement for non-execution agents when executionMemoryContext is absent', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            gh_pr_url: 'https://github.com/org/repo/pull/42',
            review_id: '123',
            review_comments_posted: '2',
            review_types: 'code_quality',
            memory_ids_used: '',
            memory_ids_rejected: '',
            memory_usage_summary: '',
            summary: 'Reviewed the PR.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-review-no-context',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'review',
        rawLogs:
          '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] Review done',
      });
      expect(result.passed).toBe(true);
    });

    it('does not apply non-execution memory field enforcement to execution agent (execution uses validateMemoryReporting directly)', async () => {
      // The execution agent uses EXECUTION_SCHEMA which requires memory fields as z.string() (not optional),
      // so Zod will already fail if they are missing. This test confirms the post-parse check does not
      // double-run for execution agents (it only runs for non-execution agents).
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'implemented',
            superpowers_subagent_driven_dev: 'used',
            superpowers_requesting_code_review: 'used',
            gh_pr_url: 'https://github.com/org/repo/pull/901',
            memory_ids_used: '',
            memory_ids_rejected: '',
            memory_usage_summary: '',
            summary: 'Implemented the feature.',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-execution-no-context',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs:
          '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\n[claude] Execution done',
        executionMemoryContext: makeMemoryContext(['mem_500']),
      });
      // Fails via validateMemoryReporting (memory_acknowledgment, memory_ids_unaccounted, memory_usage_summary),
      // NOT via the new post-parse check (which is skipped for execution agents)
      expect(result.passed).toBe(false);
      expect(result.missingFields).not.toEqual(['memory_ids_used', 'memory_ids_rejected']);
      expect(result.missingFields).toEqual(
        expect.arrayContaining([
          'memory_acknowledgment',
          'memory_ids_unaccounted',
          'memory_usage_summary',
        ])
      );
    });
  });

  // ---------------------------------------------------------------------------
  // verify — failure paths
  // ---------------------------------------------------------------------------

  describe('verify — Gemini failure', () => {
    it('returns verifierFailure when Gemini returns error', async () => {
      generateMock.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'rate limit' },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-fail',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('generic'),
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.agentData).toBeUndefined();
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: '',
      });
    });
  });

  describe('verify — JSON parse failure', () => {
    it('returns verifierFailure when response is not valid JSON', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'not json at all',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-parse',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: transcriptWithMeaningfulLines('generic'),
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: 'not json at all',
      });
    });
  });

  describe('verify — Zod validation failure', () => {
    it('returns missingFields when schema validation fails', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ gh_pr_url: 'https://github.com/org/repo/pull/1' }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-zod',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'pull_request',
        rawLogs: transcriptWithMeaningfulLines('generic'),
      });
      expect(result.passed).toBe(false);
      expect(result.verifierFailure).toBe(false);
      expect(result.missingFields.length).toBeGreaterThan(0);
      expect(result.missingFields).toContain('comments_replied');
      expect(result.missingFields).toContain('tracking_comment_id');
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: JSON.stringify({ gh_pr_url: 'https://github.com/org/repo/pull/1' }),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify — transcript truncation in logger.info
  // ---------------------------------------------------------------------------

  describe('verify — transcript truncation in log output', () => {
    const validPlanningResponse = JSON.stringify({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-100',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
      summary: 'Planned.',
      unclear_clarification: '',
    });

    it('truncates transcript to first and last line when >2 non-empty lines', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: validPlanningResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      await verifier.verify({
        taskId: 'task-trunc',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: 'first line\nsecond line\nthird line\nfourth line\nfifth line',
      });
      const infoCall = loggerInfo.mock.calls.find(
        (c: unknown[]) => typeof c[1] === 'string' && c[1] === 'Completion verifier request'
      ) as [Record<string, unknown>, string] | undefined;
      expect(infoCall).toBeDefined();
      const logged = infoCall?.[0]?.['transcript'] as string;
      expect(logged).toContain('first line');
      expect(logged).toContain('fifth line');
      expect(logged).toContain('3 lines omitted');
      expect(logged).not.toContain('second line');
    });

    it('short transcript short-circuits before logger.info (<=2 non-empty lines)', async () => {
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-short',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: 'only one line',
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual(['transcript_too_short']);
      const infoCall = loggerInfo.mock.calls.find(
        (c: unknown[]) => typeof c[1] === 'string' && c[1] === 'Completion verifier request'
      );
      expect(infoCall).toBeUndefined();
    });

    it('whitespace-only rawLogs short-circuits before logger.info', async () => {
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-empty',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: '   \n  \n   ',
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual(['transcript_too_short']);
      const infoCall = loggerInfo.mock.calls.find(
        (c: unknown[]) => typeof c[1] === 'string' && c[1] === 'Completion verifier request'
      );
      expect(infoCall).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // verify — short transcript guard
  // ---------------------------------------------------------------------------

  describe('verify — short transcript guard', () => {
    it('rejects pure infrastructure transcript without calling LLM', async () => {
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-guard-pure-infra',
        attempt: 2,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: [
          '[orchestrator] attempt 2 starting',
          '[hook] pre-hook fired',
          '[entrypoint] container ready',
          '[system] Inactivity restart completed',
          '[entrypoint] Claude attempt finished with exit code: 0',
        ].join('\n'),
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual(['transcript_too_short']);
      expect(result.verifierFailure).toBe(false);
      expect(generateMock).not.toHaveBeenCalled();
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-guard-pure-infra',
          attempt: 2,
          agentType: 'execution',
          meaningfulLines: 0,
        }),
        'Completion verifier: transcript too short, refusing to call LLM'
      );
    });

    it('rejects transcript with 4 meaningful lines mixed with infra', async () => {
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-guard-four',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: [
          '[orchestrator] starting',
          '[claude] line 1',
          '[claude] line 2',
          '[system] heartbeat',
          '[claude] line 3',
          '[claude] line 4',
        ].join('\n'),
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual(['transcript_too_short']);
      expect(generateMock).not.toHaveBeenCalled();
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ meaningfulLines: 4 }),
        'Completion verifier: transcript too short, refusing to call LLM'
      );
    });

    it('allows transcript with exactly 5 meaningful lines', async () => {
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({
            outcome: 'planned',
            superpowers_writing_plans: 'used',
            linear_url: 'https://linear.app/pbuchman/issue/INT-100',
            is_complex: '0',
            has_plan_doc: '0',
            subtask_urls: '',
            pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
            summary: 'Planned.',
            unclear_clarification: '',
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-guard-five',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('guard-five'),
      });
      expect(result.passed).toBe(true);
      expect(generateMock).toHaveBeenCalledOnce();
    });
  });

  describe('verify — JSON wrapped in markdown fences', () => {
    it('extracts JSON from surrounding text', async () => {
      const wrappedResponse = `Here is the result:\n${JSON.stringify({
        outcome: 'planned',
        superpowers_writing_plans: 'used',
        linear_url: 'https://linear.app/pbuchman/issue/INT-50',
        is_complex: '0',
        has_plan_doc: '0',
        subtask_urls: '',
        pr_url: 'https://github.com/pbuchman/intexuraos/pull/50',
        summary: 'Planned.',
        unclear_clarification: '',
      })}\nDone.`;
      generateMock.mockResolvedValueOnce({
        ok: true,
        value: {
          content: wrappedResponse,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        },
      });
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: 'task-wrapped',
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: transcriptWithMeaningfulLines('generic'),
      });
      expect(result.passed).toBe(true);
      expect(result.agentData?.agentType).toBe('planning');
      expect(result.trace).toEqual({
        transcript: expect.any(String),
        prompt: expect.any(String),
        response: wrappedResponse,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// detectFatalExitCode
// ---------------------------------------------------------------------------

describe('detectFatalExitCode', () => {
  it('returns 137 when logs contain SIGKILL exit code', () => {
    const logs =
      'some output\n[entrypoint] Claude attempt finished with exit code: 137\nfinal line';
    expect(detectFatalExitCode(logs)).toBe(137);
  });

  it('returns 139 when logs contain SIGSEGV exit code', () => {
    const logs = 'output\n[entrypoint] Claude attempt finished with exit code: 139';
    expect(detectFatalExitCode(logs)).toBe(139);
  });

  it('returns undefined for normal exit code 0', () => {
    const logs = '[entrypoint] Claude attempt finished with exit code: 0\ndone';
    expect(detectFatalExitCode(logs)).toBeUndefined();
  });

  it('returns undefined for exit code 1 (normal failure)', () => {
    const logs = '[entrypoint] Claude attempt finished with exit code: 1';
    expect(detectFatalExitCode(logs)).toBeUndefined();
  });

  it('returns undefined when no exit code pattern is present', () => {
    const logs = 'just some logs\nno exit code here';
    expect(detectFatalExitCode(logs)).toBeUndefined();
  });

  it('returns undefined when pattern appears mid-stream (outside last 5 lines) but actual exit is 0', () => {
    // The JSON blob with the embedded 137 pattern is earlier in the logs (more than 5 lines from end).
    // Only the last 5 lines are searched, so the embedded pattern is not found.
    const logs = [
      'some earlier output',
      '{"type":"result","content":"const logs = \'some output\\n[entrypoint] Claude attempt finished with exit code: 137\\nfinal line\';"}',
      'line 1',
      'line 2',
      'line 3',
      '[entrypoint] Claude attempt finished with exit code: 0',
      'final line',
    ].join('\n');
    expect(detectFatalExitCode(logs)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// verify — fatal exit code pre-check
// ---------------------------------------------------------------------------

describe('verify — fatal exit code pre-check', () => {
  it.each([
    { exitCode: 137, signal: 'SIGKILL' },
    { exitCode: 139, signal: 'SIGSEGV' },
  ])(
    'returns passed=false for exit code $exitCode ($signal) without calling Gemini',
    async ({ exitCode }) => {
      const verifier = createVerifier();
      const taskId = `task-fatal-${String(exitCode)}`;
      const result = await verifier.verify({
        taskId,
        attempt: 1,
        maxAttempts: 5,
        agentType: 'planning',
        rawLogs: `working...\n[entrypoint] Claude attempt finished with exit code: ${String(exitCode)}\n`,
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual([`fatal_exit_code_${String(exitCode)}`]);
      expect(result.verifierFailure).toBe(false);
      expect(result.agentData).toBeUndefined();
      expect(result.trace).toEqual({ transcript: expect.any(String), prompt: '', response: '' });
      expect(result.trace.transcript).toContain(`exit code: ${String(exitCode)}`);
      expect(generateMock).not.toHaveBeenCalled();
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId, agentType: 'planning', exitCode }),
        'Fatal exit code detected — skipping completion verification'
      );
    }
  );

  it('proceeds to Gemini verification for normal exit code 0', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({
          outcome: 'planned',
          superpowers_writing_plans: 'used',
          linear_url: 'https://linear.app/pbuchman/issue/INT-100',
          is_complex: '0',
          has_plan_doc: '0',
          subtask_urls: '',
          pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
          summary: 'Planned.',
          unclear_clarification: '',
        }),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.verify({
      taskId: 'task-ok',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'planning',
      rawLogs:
        '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\noutput\n[entrypoint] Claude attempt finished with exit code: 0\n',
    });
    expect(result.passed).toBe(true);
    expect(generateMock).toHaveBeenCalledOnce();
  });

  it('proceeds to Gemini verification for exit code 1 (normal failure)', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({
          outcome: 'implemented',
          superpowers_subagent_driven_dev: 'used',
          superpowers_requesting_code_review: 'not used',
          gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
          memory_ids_used: '',
          memory_ids_rejected: '',
          memory_usage_summary: '',
          summary: 'Failed normally.',
        }),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.verify({
      taskId: 'task-normal-fail',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'execution',
      rawLogs:
        '[claude] step 1\n[claude] step 2\n[claude] step 3\n[claude] step 4\noutput\n[entrypoint] Claude attempt finished with exit code: 1\n',
    });
    expect(result.passed).toBe(true);
    expect(generateMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// verify — fatal exit code pre-check via lastExitCode input
// ---------------------------------------------------------------------------

describe('verify — fatal exit code via lastExitCode input', () => {
  it.each([
    { exitCode: 137, signal: 'SIGKILL' },
    { exitCode: 139, signal: 'SIGSEGV' },
  ])(
    'short-circuits for lastExitCode=$exitCode ($signal) without calling any model',
    async ({ exitCode }) => {
      const verifier = createVerifier();
      const result = await verifier.verify({
        taskId: `task-lastexit-${String(exitCode)}`,
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: 'worker made no terminal entrypoint log before being killed externally',
        lastExitCode: exitCode,
      });
      expect(result.passed).toBe(false);
      expect(result.missingFields).toEqual([`fatal_exit_code_${String(exitCode)}`]);
      expect(result.verifierFailure).toBe(false);
      expect(result.agentData).toBeUndefined();
      expect(generateMock).not.toHaveBeenCalled();
    }
  );

  it('proceeds to verification for lastExitCode=0', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({
          outcome: 'planned',
          superpowers_writing_plans: 'used',
          linear_url: 'https://linear.app/pbuchman/issue/INT-100',
          is_complex: '0',
          has_plan_doc: '0',
          subtask_urls: '',
          pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
          summary: 'Planned.',
          unclear_clarification: '',
        }),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.verify({
      taskId: 'task-exit-zero',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'planning',
      rawLogs: 'output',
      lastExitCode: 0,
    });
    expect(result.passed).toBe(true);
    expect(generateMock).toHaveBeenCalledOnce();
  });

  it('proceeds to verification when lastExitCode is undefined', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({
          outcome: 'planned',
          superpowers_writing_plans: 'used',
          linear_url: 'https://linear.app/pbuchman/issue/INT-100',
          is_complex: '0',
          has_plan_doc: '0',
          subtask_urls: '',
          pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
          summary: 'Planned.',
          unclear_clarification: '',
        }),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.verify({
      taskId: 'task-exit-undefined',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'planning',
      rawLogs: 'output',
    });
    expect(result.passed).toBe(true);
    expect(generateMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// verify — succeededModelName threading
// ---------------------------------------------------------------------------

describe('verify — succeededModelName', () => {
  const validPlanningContent = JSON.stringify({
    outcome: 'planned',
    superpowers_writing_plans: 'used',
    linear_url: 'https://linear.app/pbuchman/issue/INT-100',
    is_complex: '0',
    has_plan_doc: '0',
    subtask_urls: '',
    pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
    summary: 'Planned.',
    unclear_clarification: '',
  });

  it('reports the primary model name when primary succeeds', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: validPlanningContent,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    const verifier = createVerifier({ primaryModelName: 'or:google/gemma-4-31b-it:free' });
    const result = await verifier.verify({
      taskId: 'task-primary',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'planning',
      rawLogs: 'logs',
    });
    expect(result.passed).toBe(true);
    expect(result.succeededModelName).toBe('or:google/gemma-4-31b-it:free');
  });

  it('reports the fallback model name when primary fails and fallback succeeds', async () => {
    const fallbackGenerate = vi.fn().mockResolvedValueOnce({
      ok: true,
      value: {
        content: validPlanningContent,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    generateMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'primary down' },
    });
    const verifier = createVerifier({
      primaryModelName: 'or:google/gemma-4-31b-it:free',
      fallbackClients: [{ generate: fallbackGenerate }],
      fallbackModelNames: ['gemini-2.5-flash'],
    });
    const result = await verifier.verify({
      taskId: 'task-fallback-name',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'planning',
      rawLogs: 'logs',
    });
    expect(result.passed).toBe(true);
    expect(result.succeededModelName).toBe('gemini-2.5-flash');
  });

  it('reports the model name even on schema validation failure', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({ outcome: 'planned' }), // missing required fields
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
      },
    });
    const verifier = createVerifier({ primaryModelName: 'or:google/gemma-4-31b-it:free' });
    const result = await verifier.verify({
      taskId: 'task-schema-fail',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'planning',
      rawLogs: 'logs',
    });
    expect(result.passed).toBe(false);
    expect(result.succeededModelName).toBe('or:google/gemma-4-31b-it:free');
  });

  it('leaves succeededModelName undefined when all models fail to generate', async () => {
    generateMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'primary down' },
    });
    const verifier = createVerifier({ primaryModelName: 'or:google/gemma-4-31b-it:free' });
    const result = await verifier.verify({
      taskId: 'task-all-fail',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'planning',
      rawLogs: 'logs',
    });
    expect(result.passed).toBe(false);
    expect(result.verifierFailure).toBe(true);
    expect(result.succeededModelName).toBeUndefined();
  });

  it('leaves succeededModelName undefined on fatal exit code short-circuit', async () => {
    const verifier = createVerifier();
    const result = await verifier.verify({
      taskId: 'task-fatal',
      attempt: 1,
      maxAttempts: 5,
      agentType: 'execution',
      rawLogs: 'output\n[entrypoint] Claude attempt finished with exit code: 137\n',
    });
    expect(result.passed).toBe(false);
    expect(result.succeededModelName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prompt examples — no anchoring URLs
// ---------------------------------------------------------------------------

describe('prompt examples contain no real repo/issue URLs', () => {
  const forbiddenFragments = [
    'pbuchman/intexuraos/pull/944',
    'pbuchman/intexuraos/pull/901',
    'pbuchman/intexuraos/pull/950',
    'INT-631',
    'INT-632',
    'INT-633',
  ];

  const builders = [
    { name: 'buildPlanningPrompt', build: buildPlanningPrompt },
    { name: 'buildExecutionPrompt', build: buildExecutionPrompt },
    { name: 'buildPullRequestPrompt', build: buildPullRequestPrompt },
    { name: 'buildReviewPrompt', build: buildReviewPrompt },
    { name: 'buildRemediationPrompt', build: buildRemediationPrompt },
  ] as const;

  for (const { name, build } of builders) {
    for (const fragment of forbiddenFragments) {
      it(`${name} prompt does not contain "${fragment}"`, () => {
        const prompt = build('sample transcript');
        expect(prompt).not.toContain(fragment);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// getLast20Lines
// ---------------------------------------------------------------------------

describe('getLast20Lines', () => {
  it('returns last 20 lines from raw logs', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${String(i + 1)}`);
    const result = getLast20Lines(lines.join('\n'));
    const resultLines = result.split('\n');
    expect(resultLines).toHaveLength(20);
    expect(resultLines[0]).toBe('line-31');
    expect(resultLines[19]).toBe('line-50');
  });

  it('returns all lines when fewer than 20', () => {
    const result = getLast20Lines('a\nb\nc');
    expect(result).toBe('a\nb\nc');
  });

  it('returns empty string for empty input', () => {
    const result = getLast20Lines('');
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// RESUME_SUMMARY_SCHEMA
// ---------------------------------------------------------------------------

describe('RESUME_SUMMARY_SCHEMA', () => {
  it('accepts valid summary', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({ summary: 'Updated the auth flow.' });
    expect(result.success).toBe(true);
  });

  it('rejects missing summary field', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string summary', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({ summary: 42 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildResumeSummaryPrompt
// ---------------------------------------------------------------------------

describe('buildResumeSummaryPrompt', () => {
  it('includes the transcript in the prompt', () => {
    const prompt = buildResumeSummaryPrompt('some log output');
    expect(prompt).toContain('some log output');
  });

  it('instructs Gemini to extract a summary field as JSON', () => {
    const prompt = buildResumeSummaryPrompt('log');
    expect(prompt).toContain('summary');
    expect(prompt).toContain('JSON');
  });

  it('mentions the last assistant messages as the source', () => {
    const prompt = buildResumeSummaryPrompt('log');
    expect(prompt).toContain('assistant');
  });
});

// ---------------------------------------------------------------------------
// extractResumeSummary
// ---------------------------------------------------------------------------

describe('OrchestratorCompletionVerifier.extractResumeSummary', () => {
  it('returns summary string on success', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({ summary: 'Updated the auth flow and fixed the redirect.' }),
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.extractResumeSummary('task-1', 'some raw logs');
    expect(result).toBe('Updated the auth flow and fixed the redirect.');
  });

  it('returns undefined when LLM generate fails', async () => {
    generateMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'GENERATION_FAILED', message: 'API error' },
    });
    const verifier = createVerifier();
    const result = await verifier.extractResumeSummary('task-1', 'some raw logs');
    expect(result).toBeUndefined();
  });

  it('returns undefined when JSON cannot be parsed', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: 'not json at all',
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.extractResumeSummary('task-1', 'some raw logs');
    expect(result).toBeUndefined();
  });

  it('returns undefined when Zod validation fails (missing summary field)', async () => {
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({ wrong_field: 'value' }),
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier();
    const result = await verifier.extractResumeSummary('task-1', 'some raw logs');
    expect(result).toBeUndefined();
  });

  it('falls back to secondary model when primary fails', async () => {
    const fallbackGenerate = vi.fn();
    generateMock.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'API_ERROR', message: 'Primary failed' },
    });
    fallbackGenerate.mockResolvedValueOnce({
      ok: true as const,
      value: {
        content: JSON.stringify({ summary: 'Fallback summary.' }),
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier({
      fallbackClients: [{ generate: fallbackGenerate }],
      fallbackModelNames: ['or:meta-llama/llama-4-scout:free'],
    });
    const result = await verifier.extractResumeSummary('task-fallback', 'some raw logs');
    expect(result).toBe('Fallback summary.');
    expect(fallbackGenerate).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when all models (primary + fallback) fail', async () => {
    const fallbackGenerate = vi.fn();
    generateMock.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'API_ERROR', message: 'Primary failed' },
    });
    fallbackGenerate.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'API_ERROR', message: 'Fallback also failed' },
    });
    const verifier = createVerifier({
      fallbackClients: [{ generate: fallbackGenerate }],
    });
    const result = await verifier.extractResumeSummary('task-all-fail', 'some raw logs');
    expect(result).toBeUndefined();
    expect(fallbackGenerate).toHaveBeenCalledTimes(1);
  });

  it('uses last 20 lines of logs as transcript', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${String(i + 1)}`);
    generateMock.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify({ summary: 'Done.' }),
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, costUsd: 0.0001 },
      },
    });
    const verifier = createVerifier();
    await verifier.extractResumeSummary('task-1', lines.join('\n'));

    const calledPrompt = generateMock.mock.calls[0]?.[0] as string;
    expect(calledPrompt).toContain('line-11');
    expect(calledPrompt).toContain('line-30');
    expect(calledPrompt).not.toContain('line-10');
  });
});

describe('getVerifierTaskId', () => {
  it('returns null when called outside any AsyncLocalStorage context', () => {
    expect(getVerifierTaskId()).toBeNull();
  });
});
