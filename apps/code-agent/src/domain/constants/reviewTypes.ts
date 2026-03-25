/**
 * Review type constants — single source of truth.
 *
 * ALL_REVIEW_TYPES: the complete set used by validation and event storage.
 * LLM_TOOL_REVIEW_TYPES: the subset exposed to the LLM tool enum.
 *
 * plan_review is excluded from the LLM tool enum because plan-only PRs are
 * deterministically routed by evaluatePlanFiles() before LLM triage runs.
 */

export const ALL_REVIEW_TYPES = [
  'code_quality',
  'security',
  'architecture',
  'plan_review',
  'test_quality',
] as const;
export type ReviewType = (typeof ALL_REVIEW_TYPES)[number];

export const LLM_TOOL_REVIEW_TYPES = ALL_REVIEW_TYPES.filter(
  (t): t is Exclude<ReviewType, 'plan_review'> => t !== 'plan_review',
);
