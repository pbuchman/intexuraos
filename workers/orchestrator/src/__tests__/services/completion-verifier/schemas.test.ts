import { describe, expect, it } from 'vitest';
import {
  EXECUTION_SCHEMA,
  PLANNING_SCHEMA,
  PULL_REQUEST_SCHEMA,
  REMEDIATION_SCHEMA,
  REVIEW_SCHEMA,
  getSchemaForAgent,
  toAgentData,
} from '../../../services/completion-verifier/schemas.js';

describe('getSchemaForAgent', () => {
  it('returns PLANNING_SCHEMA for planning', () => {
    expect(getSchemaForAgent('planning')).toBe(PLANNING_SCHEMA);
  });

  it('returns EXECUTION_SCHEMA for execution', () => {
    expect(getSchemaForAgent('execution')).toBe(EXECUTION_SCHEMA);
  });

  it('returns REVIEW_SCHEMA for review', () => {
    expect(getSchemaForAgent('review')).toBe(REVIEW_SCHEMA);
  });

  it('returns REMEDIATION_SCHEMA for remediation', () => {
    expect(getSchemaForAgent('remediation')).toBe(REMEDIATION_SCHEMA);
  });

  it('returns PULL_REQUEST_SCHEMA for pull_request', () => {
    expect(getSchemaForAgent('pull_request')).toBe(PULL_REQUEST_SCHEMA);
  });

  it('returns PULL_REQUEST_SCHEMA for ask_agent (fallback)', () => {
    // ask_agent is declared in CompletionAgentType but isn't a primary selector;
    // schema selection falls through to PULL_REQUEST_SCHEMA.
    expect(getSchemaForAgent('ask_agent')).toBe(PULL_REQUEST_SCHEMA);
  });
});

describe('toAgentData', () => {
  it('wraps planning parsed data with agentType', () => {
    const parsed = {
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/x/issue/X-1',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: 'https://github.com/o/r/pull/1',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 's',
      unclear_clarification: '',
    };
    const result = toAgentData('planning', parsed);
    expect(result).toEqual({ agentType: 'planning', ...parsed });
  });

  it('wraps execution parsed data with agentType', () => {
    const parsed = {
      outcome: 'implemented',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: 'https://github.com/o/r/pull/1',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 's',
    };
    expect(toAgentData('execution', parsed)).toEqual({ agentType: 'execution', ...parsed });
  });

  it('wraps review parsed data with agentType', () => {
    const parsed = {
      gh_pr_url: 'https://github.com/o/r/pull/1',
      review_comments_posted: '3',
      review_types: 'code_quality',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      requirements_tracker_updated: '',
      gh_actions_status: '',
      needs_remediation: '0',
      review_body: '',
      review_inline_comments: '',
      summary: 's',
    };
    expect(toAgentData('review', parsed)).toEqual({ agentType: 'review', ...parsed });
  });

  it('wraps remediation parsed data with agentType', () => {
    const parsed = {
      outcome: 'implemented',
      gh_pr_url: 'https://github.com/o/r/pull/1',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      requires_re_review: '1',
      summary: 's',
    };
    expect(toAgentData('remediation', parsed)).toEqual({ agentType: 'remediation', ...parsed });
  });

  it('wraps pull_request parsed data with agentType', () => {
    const parsed = {
      gh_pr_url: 'https://github.com/o/r/pull/1',
      comments_replied: 'yes',
      tracking_comment_id: '1',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 's',
    };
    expect(toAgentData('pull_request', parsed)).toEqual({ agentType: 'pull_request', ...parsed });
  });
});

// ---------------------------------------------------------------------------
// Schema refinement edge cases.
// ---------------------------------------------------------------------------
describe('PLANNING_SCHEMA refinement', () => {
  const base = {
    outcome: 'planned' as const,
    superpowers_writing_plans: 'used' as const,
    linear_url: 'https://linear.app/x/issue/X-1',
    is_complex: '0' as const,
    has_plan_doc: '0' as const,
    subtask_urls: '',
    pr_url: 'https://github.com/o/r/pull/1',
    summary: 's',
    unclear_clarification: '',
  };

  it('rejects outcome=planned with pr_url=""', () => {
    const result = PLANNING_SCHEMA.safeParse({ ...base, pr_url: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'pr_url')).toBe(true);
    }
  });

  it('accepts outcome=unclear with pr_url=""', () => {
    const result = PLANNING_SCHEMA.safeParse({
      ...base,
      outcome: 'unclear',
      pr_url: '',
      unclear_clarification: 'why unclear',
    });
    expect(result.success).toBe(true);
  });
});

describe('EXECUTION_SCHEMA refinement', () => {
  const base = {
    outcome: 'implemented' as const,
    superpowers_subagent_driven_dev: 'used' as const,
    superpowers_requesting_code_review: 'used' as const,
    gh_pr_url: 'https://github.com/o/r/pull/1',
    memory_ids_used: '',
    memory_ids_rejected: '',
    memory_usage_summary: '',
    summary: 's',
  };

  it('rejects outcome=implemented with gh_pr_url=""', () => {
    const result = EXECUTION_SCHEMA.safeParse({ ...base, gh_pr_url: '' });
    expect(result.success).toBe(false);
  });

  it('rejects outcome=already_completed with gh_pr_url=""', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      ...base,
      outcome: 'already_completed',
      gh_pr_url: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('REMEDIATION_SCHEMA refinement', () => {
  const base = {
    outcome: 'implemented' as const,
    gh_pr_url: 'https://github.com/o/r/pull/1',
    memory_ids_used: '',
    memory_ids_rejected: '',
    memory_usage_summary: '',
    requires_re_review: '1',
    summary: 's',
  };

  it('rejects outcome=implemented with gh_pr_url=""', () => {
    const result = REMEDIATION_SCHEMA.safeParse({ ...base, gh_pr_url: '' });
    expect(result.success).toBe(false);
  });

  it('accepts outcome=already_completed with gh_pr_url=""', () => {
    const result = REMEDIATION_SCHEMA.safeParse({
      ...base,
      outcome: 'already_completed',
      gh_pr_url: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('REVIEW_SCHEMA review_id preprocess', () => {
  const base = {
    gh_pr_url: 'https://github.com/o/r/pull/1',
    review_comments_posted: '3',
    review_types: 'code_quality',
    memory_ids_used: '',
    memory_ids_rejected: '',
    memory_usage_summary: '',
    requirements_tracker_updated: '',
    gh_actions_status: '',
    needs_remediation: '0',
    review_body: '',
    review_inline_comments: '',
    summary: 's',
  };

  it('treats review_id="" as undefined (coerces empty string to omitted)', () => {
    const result = REVIEW_SCHEMA.safeParse({ ...base, review_id: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review_id).toBeUndefined();
    }
  });

  it('rejects non-numeric review_id like "abc"', () => {
    const result = REVIEW_SCHEMA.safeParse({ ...base, review_id: 'abc' });
    expect(result.success).toBe(false);
  });

  it('accepts a numeric review_id like "123"', () => {
    const result = REVIEW_SCHEMA.safeParse({ ...base, review_id: '123' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review_id).toBe('123');
    }
  });

  it('defaults needs_remediation to "1" when omitted', () => {
    const { needs_remediation: _omit, ...without } = base;
    const result = REVIEW_SCHEMA.safeParse(without);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.needs_remediation).toBe('1');
    }
  });
});
