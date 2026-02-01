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
