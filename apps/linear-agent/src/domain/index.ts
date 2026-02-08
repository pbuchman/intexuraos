/**
 * Domain layer exports for linear-agent.
 */

export * from './models.js';
export * from './errors.js';
export type {
  LinearConnectionRepository,
  FailedIssueRepository,
  LinearApiClient,
  LinearActionExtractionService,
  ProcessedActionRepository,
  LinearIssueRepository,
  LinearCommentRepository,
} from './ports.js';
export {
  processLinearAction,
  type ProcessLinearActionDeps,
  type ProcessLinearActionRequest,
  type ProcessLinearActionResponse,
} from './useCases/processLinearAction.js';
export {
  listIssues,
  type ListIssuesDeps,
  type ListIssuesRequest,
  type ListIssuesResponse,
  type GroupedIssues,
} from './useCases/listIssues.js';
export {
  generateIssueTitle,
  type GenerateIssueTitleDeps,
  type GenerateIssueTitleRequest,
  type GeneratedTitle,
  type GenerateTitleError,
} from './useCases/generateIssueTitle.js';
export {
  validateIssue,
  type ValidateIssueDeps,
  type ValidateIssueRequest,
  type ValidatedIssue,
  type ValidateIssueError,
} from './useCases/validateIssue.js';
export type { LinearWebhookEvent, LinearWebhookPayload, WebhookAction, LinearCommentWebhookEvent, LinearCommentWebhookPayload } from './webhookTypes.js';
export { mapWebhookToSyncedIssue, mapApiIssueToSyncedIssue } from './issueMapper.js';
export {
  syncSingleIssue,
  type SyncSingleIssueDeps,
  type SyncSingleIssueResult,
} from './useCases/syncSingleIssueUseCase.js';
export {
  syncCommentFromWebhook,
  type SyncCommentDeps,
  type SyncCommentResult,
} from './useCases/syncCommentFromWebhook.js';
export {
  fullSync,
  fullSyncAllUsers,
  type FullSyncDeps,
  type SyncStats,
} from './useCases/fullSyncUseCase.js';
