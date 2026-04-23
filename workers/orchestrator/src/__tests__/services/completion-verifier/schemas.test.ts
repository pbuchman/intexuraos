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
