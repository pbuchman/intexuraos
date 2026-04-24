import { z } from 'zod';

export type CompletionAgentType =
  | 'planning'
  | 'execution'
  | 'pull_request'
  | 'review'
  | 'remediation'
  | 'ask_agent';

export interface PlanningAgentData {
  agentType: 'planning';
  outcome: 'planned' | 'unclear';
  superpowers_writing_plans: 'used' | 'not used';
  linear_url: string;
  is_complex: '0' | '1';
  has_plan_doc: '0' | '1';
  subtask_urls: string;
  pr_url: string;
  memory_ids_used: string;
  memory_ids_rejected: string;
  memory_usage_summary: string;
  summary: string;
  unclear_clarification: string;
}

export interface ExecutionAgentData {
  agentType: 'execution';
  outcome: 'implemented' | 'already_completed' | 'failed';
  superpowers_subagent_driven_dev: 'used' | 'not used';
  superpowers_requesting_code_review: 'used' | 'not used';
  gh_pr_url: string;
  failure_reason: string;
  memory_ids_used: string;
  memory_ids_rejected: string;
  memory_usage_summary: string;
  summary: string;
}

export interface PullRequestAgentData {
  agentType: 'pull_request';
  gh_pr_url: string;
  comments_replied: 'yes' | 'no';
  tracking_comment_id: string;
  memory_ids_used: string;
  memory_ids_rejected: string;
  memory_usage_summary: string;
  summary: string;
}

export interface ReviewAgentData {
  agentType: 'review';
  gh_pr_url: string;
  review_id?: string | undefined;
  review_comments_posted: string;
  review_types: string;
  memory_ids_used: string;
  memory_ids_rejected: string;
  memory_usage_summary: string;
  requirements_tracker_updated: string;
  gh_actions_status: string;
  needs_remediation: string;
  review_body: string;
  review_inline_comments: string;
  summary: string;
}

export interface RemediationAgentData {
  agentType: 'remediation';
  outcome: 'implemented' | 'already_completed';
  gh_pr_url: string;
  memory_ids_used: string;
  memory_ids_rejected: string;
  memory_usage_summary: string;
  requires_re_review: string;
  summary: string;
}

export const PLANNING_SCHEMA = z
  .object({
    outcome: z.enum(['planned', 'unclear']),
    superpowers_writing_plans: z.enum(['used', 'not used']),
    linear_url: z.string(),
    is_complex: z.enum(['0', '1']),
    has_plan_doc: z.enum(['0', '1']),
    subtask_urls: z.string(),
    pr_url: z.string(),
    memory_ids_used: z.string().optional().default(''),
    memory_ids_rejected: z.string().optional().default(''),
    memory_usage_summary: z.string().optional().default(''),
    summary: z.string(),
    unclear_clarification: z.string(),
  })
  .refine((data) => data.outcome !== 'planned' || data.pr_url !== '', {
    message: 'pr_url is required when outcome is "planned"',
    path: ['pr_url'],
  });

export const EXECUTION_SCHEMA = z
  .object({
    outcome: z.enum(['implemented', 'already_completed', 'failed']),
    superpowers_subagent_driven_dev: z.enum(['used', 'not used']),
    superpowers_requesting_code_review: z.enum(['used', 'not used']),
    gh_pr_url: z.string(),
    failure_reason: z.string().optional().default(''),
    memory_ids_used: z.string().optional().default(''),
    memory_ids_rejected: z.string().optional().default(''),
    memory_usage_summary: z.string().optional().default(''),
    summary: z.string(),
  })
  .refine((data) => data.outcome === 'failed' || data.gh_pr_url !== '', {
    message: 'gh_pr_url is required for successful execution outcomes',
    path: ['gh_pr_url'],
  });

export const PULL_REQUEST_SCHEMA = z.object({
  gh_pr_url: z.string(),
  comments_replied: z.enum(['yes', 'no']),
  tracking_comment_id: z.string().min(1),
  memory_ids_used: z.string().optional().default(''),
  memory_ids_rejected: z.string().optional().default(''),
  memory_usage_summary: z.string().optional().default(''),
  summary: z.string(),
});

export const REVIEW_SCHEMA = z.object({
  gh_pr_url: z.string(),
  review_id: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^\d+$/, 'review_id must be a numeric string').optional()
  ),
  review_comments_posted: z
    .string()
    .regex(/^\d+$/, 'review_comments_posted must be a numeric string'),
  review_types: z.string().trim().min(1, 'review_types must not be empty'),
  memory_ids_used: z.string().optional().default(''),
  memory_ids_rejected: z.string().optional().default(''),
  memory_usage_summary: z.string().optional().default(''),
  requirements_tracker_updated: z.string().optional().default(''),
  gh_actions_status: z.string().optional().default(''),
  needs_remediation: z
    .string()
    .regex(/^[01]$/)
    .optional()
    .default('1'),
  review_body: z.string().optional().default(''),
  review_inline_comments: z.string().optional().default(''),
  summary: z.string(),
});

export const REMEDIATION_SCHEMA = z
  .object({
    outcome: z.enum(['implemented', 'already_completed']),
    gh_pr_url: z.string(),
    memory_ids_used: z.string().optional().default(''),
    memory_ids_rejected: z.string().optional().default(''),
    memory_usage_summary: z.string().optional().default(''),
    requires_re_review: z.string().regex(/^[01]$/, 'requires_re_review must be "0" or "1"'),
    summary: z.string(),
  })
  .refine((data) => data.outcome !== 'implemented' || data.gh_pr_url !== '', {
    message: 'gh_pr_url is required when outcome is "implemented"',
    path: ['gh_pr_url'],
  });

export const RESUME_SUMMARY_SCHEMA = z.object({
  summary: z.string(),
});

export function getSchemaForAgent(agentType: CompletionAgentType): z.ZodType {
  if (agentType === 'planning') {
    return PLANNING_SCHEMA;
  }
  if (agentType === 'execution') {
    return EXECUTION_SCHEMA;
  }
  if (agentType === 'review') {
    return REVIEW_SCHEMA;
  }
  if (agentType === 'remediation') {
    return REMEDIATION_SCHEMA;
  }
  return PULL_REQUEST_SCHEMA;
}

export function toAgentData(
  agentType: CompletionAgentType,
  parsed: unknown
):
  | PlanningAgentData
  | ExecutionAgentData
  | PullRequestAgentData
  | ReviewAgentData
  | RemediationAgentData {
  if (agentType === 'planning') {
    const data = parsed as z.infer<typeof PLANNING_SCHEMA>;
    return { agentType: 'planning', ...data };
  }
  if (agentType === 'execution') {
    const data = parsed as z.infer<typeof EXECUTION_SCHEMA>;
    return { agentType: 'execution', ...data };
  }
  if (agentType === 'review') {
    const data = parsed as z.infer<typeof REVIEW_SCHEMA>;
    return { agentType: 'review', ...data };
  }
  if (agentType === 'remediation') {
    const data = parsed as z.infer<typeof REMEDIATION_SCHEMA>;
    return { agentType: 'remediation', ...data };
  }
  const data = parsed as z.infer<typeof PULL_REQUEST_SCHEMA>;
  return { agentType: 'pull_request', ...data };
}
