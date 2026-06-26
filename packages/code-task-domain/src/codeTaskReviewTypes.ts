export const CODE_TASK_REVIEW_TYPES = [
  'code_quality',
  'security',
  'architecture',
  'plan_review',
  'test_quality',
  'documentation',
] as const;

export type CodeTaskReviewType = (typeof CODE_TASK_REVIEW_TYPES)[number];
export type LlmTriageReviewType = Exclude<CodeTaskReviewType, 'plan_review'>;

const CODE_TASK_REVIEW_TYPE_SET = new Set<string>(CODE_TASK_REVIEW_TYPES);

export function isCodeTaskReviewType(value: string): value is CodeTaskReviewType {
  return CODE_TASK_REVIEW_TYPE_SET.has(value);
}

export const LLM_TRIAGE_REVIEW_TYPES = CODE_TASK_REVIEW_TYPES.filter(
  (reviewType): reviewType is LlmTriageReviewType => reviewType !== 'plan_review'
);
