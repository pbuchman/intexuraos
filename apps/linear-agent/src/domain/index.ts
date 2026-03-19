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
  CodeAgentClient,
  CodeAgentError,
  TriggerCodeTaskResponse,
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
} from './useCases/listIssues.js';
export { syncedToLinearIssue } from './syncedIssueMapper.js';
export { buildIssueHierarchy, type IssueHierarchy } from './issueTreeBuilder.js';
export {
  groupIssuesByDashboardColumn,
  DONE_RECENT_DAYS,
  type GroupIssuesOptions,
} from './issueGrouper.js';
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
export type { LinearWebhookEvent, LinearWebhookPayload, LinearWebhookUpdatedFrom, WebhookAction, LinearCommentWebhookEvent, LinearCommentWebhookPayload } from './webhookTypes.js';
export type { IssueWebhookData, CommentWebhookData } from './webhookTypeGuards.js';
export { isIssueWebhookData, isCommentWebhookData } from './webhookTypeGuards.js';
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
export {
  shouldTriggerCodeTask,
  triggerCodeTaskFromAssignment,
  type TriggerCodeTaskDeps,
} from './useCases/triggerCodeTaskFromAssignment.js';
export { STATE_NAME_MAP, findStateId } from './stateUtils.js';
export {
  toCommentSummary,
  buildIssueDisplayResponse,
  type IssueDisplayResponse,
} from './issueDisplayMapper.js';
export { resolveDesiredLabelIds } from './useCases/resolveLabels.js';
export { buildIssueTree } from './useCases/buildIssueTree.js';
export {
  retryFailedIssue,
  type RetryFailedIssueDeps,
  type RetryFailedIssueRequest,
  type RetryFailedIssueResult,
} from './useCases/retryFailedIssue.js';
export {
  getIssueComments,
  type GetIssueCommentsDeps,
  type GetIssueCommentsRequest,
  type PaginatedComments,
} from './useCases/getIssueComments.js';
export {
  getIssueDetail,
  type GetIssueDetailDeps,
  type GetIssueDetailRequest,
  type IssueDetailResponse,
} from './useCases/getIssueDetail.js';
export {
  processWebhook,
  type ProcessWebhookDeps,
  type WebhookPayload,
  type ProcessWebhookResult,
} from './useCases/processWebhook.js';
export { parseExtractionResponse } from './extractionParser.js';
