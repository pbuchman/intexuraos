import { hasCodeTaskLabel } from '@intexuraos/linear-domain';
import type { PromptBuilder } from './prompt-builder.js';
import { askAgentPrompt } from './prompts/ask-agent-prompt.js';
import { executionPrompt } from './prompts/execution-prompt.js';
import { planningPrompt } from './prompts/planning-prompt.js';
import { prReviewOverlayPrompt } from './prompts/pr-review-overlay-prompt.js';
import type { SystemPromptParams } from './prompts/prompt-shared.js';
import { pullRequestPrompt } from './prompts/pull-request-prompt.js';
import { remediationPrompt } from './prompts/remediation-prompt.js';
import { reviewPrompt } from './prompts/review-prompt.js';

export type { SystemPromptParams } from './prompts/prompt-shared.js';
export { askAgentPrompt } from './prompts/ask-agent-prompt.js';
export { executionPrompt } from './prompts/execution-prompt.js';
export { planningPrompt } from './prompts/planning-prompt.js';
export { prReviewOverlayPrompt } from './prompts/pr-review-overlay-prompt.js';
export { pullRequestPrompt } from './prompts/pull-request-prompt.js';
export { remediationPrompt } from './prompts/remediation-prompt.js';
export { reviewPrompt } from './prompts/review-prompt.js';

type AgentType = NonNullable<SystemPromptParams['agentType']>;

const PROMPT_REGISTRY: Record<AgentType, PromptBuilder<SystemPromptParams>> = {
  planning: planningPrompt,
  execution: executionPrompt,
  pull_request: pullRequestPrompt,
  review: reviewPrompt,
  remediation: remediationPrompt,
  ask_agent: askAgentPrompt,
};

export function getPromptForAgent(agentType: AgentType): PromptBuilder<SystemPromptParams> {
  return PROMPT_REGISTRY[agentType];
}

export function buildSystemPrompt(params: SystemPromptParams): string {
  const isPullRequestTask =
    params.agentType === 'pull_request' ||
    params.linearIssueLabels.some((label) => label.trim().toLowerCase() === 'pr-comment');
  if (isPullRequestTask) {
    return pullRequestPrompt.build(params);
  }

  if (params.agentType === 'ask_agent') {
    return askAgentPrompt.build(params);
  }

  const resolvedAgentType =
    params.agentType ?? (hasCodeTaskLabel(params.linearIssueLabels) ? 'execution' : 'planning');

  if (resolvedAgentType === 'review') {
    return reviewPrompt.build(params);
  }

  if (resolvedAgentType === 'remediation') {
    return remediationPrompt.build(params);
  }

  const overlay = prReviewOverlayPrompt.build(params);

  if (resolvedAgentType === 'planning') {
    return planningPrompt.build(params) + overlay;
  }

  return executionPrompt.build(params) + overlay;
}
