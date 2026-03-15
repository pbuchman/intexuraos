import { normalizeLabel } from '@intexuraos/common-core';
import type { AgentType, CodeTask } from '../models/codeTask.js';
import { hasCodeTaskLabel } from './labelUtils.js';

const PR_COMMENT_SYSTEM_PROMPT_HASH = 'pr-comment-auto';
const REVIEW_SYSTEM_PROMPT_HASH = 'review-auto';

export function hasPrCommentLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'pr-comment');
}

export function resolveTaskAgentType(
  task: Pick<CodeTask, 'agentType' | 'systemPromptHash' | 'prNumber' | 'prBranch' | 'result'>,
  linearIssueLabels: string[]
): AgentType {
  if (task.agentType !== undefined) {
    return task.agentType;
  }
  if (task.systemPromptHash === PR_COMMENT_SYSTEM_PROMPT_HASH) {
    return 'pull_request';
  }
  if (task.systemPromptHash === REVIEW_SYSTEM_PROMPT_HASH) {
    return 'review';
  }
  if (
    task.prNumber !== undefined ||
    task.prBranch !== undefined ||
    task.result?.prUrl !== undefined
  ) {
    return 'execution';
  }
  return hasCodeTaskLabel(linearIssueLabels) ? 'execution' : 'planning';
}

export function ensureDispatchLabelsForAgentType(
  linearIssueLabels: string[],
  agentType: AgentType
): string[] {
  if (agentType !== 'pull_request' || hasPrCommentLabel(linearIssueLabels)) {
    return linearIssueLabels;
  }
  return [...linearIssueLabels, 'pr-comment'];
}
