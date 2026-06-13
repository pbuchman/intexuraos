import {
  CODE_TASK_REVIEW_TYPES,
  LLM_TRIAGE_REVIEW_TYPES,
  type CodeTaskReviewType,
} from '@intexuraos/code-task-domain';

export const ALL_REVIEW_TYPES = CODE_TASK_REVIEW_TYPES;
export type ReviewType = CodeTaskReviewType;

export const LLM_TOOL_REVIEW_TYPES = LLM_TRIAGE_REVIEW_TYPES;
