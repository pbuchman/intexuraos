/**
 * Shared types for UnifiedEvaluator and its sibling modules.
 */

import type { Logger, Result } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import type { WebhookRulesService } from '../gitHubWebhookRules.js';
import type { WebhookDispatchService, CIFailureDispatchService } from '../gitHubDispatchService.js';
import type { EventDecisionRepository } from '../../repositories/eventDecisionRepository.js';
import type { GitHubAgentEvalResult, GitHubAgentError } from '../../usecases/githubAgent.js';
import type {
  CreateReviewTaskRequest,
  CreateReviewTaskError,
  CreateReviewTaskResult,
} from '../../usecases/createReviewTask.js';
import type { GitHubEventLogEntryRepository } from '../../repositories/gitHubEventLogEntryRepository.js';
import type { AutomationLog } from '../../ports/automationLog.js';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';

export interface UnifiedEvaluatorDeps {
  webhookRules: WebhookRulesService;
  dispatchService: WebhookDispatchService;
  ciFailureDispatchService?: CIFailureDispatchService;
  eventDecisionRepo: EventDecisionRepository;
  gitHubEventLogEntryRepo?: GitHubEventLogEntryRepository;
  evaluateEvent?: ((event: GitHubPREvent, correctionContext?: string) => Promise<Result<GitHubAgentEvalResult, GitHubAgentError>>) | undefined;
  /** Pre-bound review task creator. Logger is injected at call time; all other deps are closed over at wiring. */
  createReviewTask: (logger: Logger, request: CreateReviewTaskRequest) => Promise<Result<CreateReviewTaskResult, CreateReviewTaskError>>;
  automationLog: AutomationLog;
  /** Resolve a GitHub login to a platform userId for OAuth token lookup. */
  resolveTokenUserId?: ((senderLogin: string) => Promise<string | undefined>) | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
  allowedBots: Set<string>;
  /** Code task repository for remediation interception on synchronize events. */
  codeTaskRepo?: CodeTaskRepository | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
  /** Best-effort callback to post a GitHub comment when an unauthorized sender is rejected. */
  onUnauthorizedSender?: ((event: GitHubPREvent) => Promise<void>) | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
  /** Best-effort callback when LLM triage skips a review. Used to set ready-to-merge label. */
  onReviewSkipped?: ((params: { repository: string; prNumber: number }) => Promise<void>) | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
}

export interface UnifiedEvaluator {
  evaluate(event: GitHubPREvent, logger: Logger): Promise<void>;
}
