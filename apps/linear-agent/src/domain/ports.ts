/**
 * Ports (interfaces) for Linear integration.
 * These define contracts for infrastructure adapters.
 */

import type { Result } from '@intexuraos/common-core';
import type {
  LinearConnection,
  LinearConnectionPublic,
  LinearIssue,
  LinearIssueWithTeam,
  LinearTeam,
  CreateIssueInput,
  FailedLinearIssue,
  ExtractedIssueData,
  ProcessedAction,
  WorkflowState,
  SyncedLinearIssue,
} from './models.js';
import type { LinearError } from './errors.js';

/** Repository for Linear connection configuration */
export interface LinearConnectionRepository {
  /** Save or update a user's Linear connection */
  save(
    userId: string,
    apiKey: string,
    teamId: string,
    teamName: string
  ): Promise<Result<LinearConnectionPublic, LinearError>>;

  /** Get a user's connection (without API key) */
  getConnection(userId: string): Promise<Result<LinearConnectionPublic | null, LinearError>>;

  /** Get a user's API key (if connected) */
  getApiKey(userId: string): Promise<Result<string | null, LinearError>>;

  /** Get full connection data (internal use only) */
  getFullConnection(userId: string): Promise<Result<LinearConnection | null, LinearError>>;

  /** Check if user is connected */
  isConnected(userId: string): Promise<Result<boolean, LinearError>>;

  /** Disconnect user's Linear integration */
  disconnect(userId: string): Promise<Result<LinearConnectionPublic, LinearError>>;

  /** Find user ID by Linear team ID (for webhook routing) */
  findUserIdByTeamId(teamId: string): Promise<Result<string | null, LinearError>>;

  /** Find webhook secret by Linear team ID (for webhook signature validation) */
  findWebhookSecretByTeamId(teamId: string): Promise<Result<{ userId: string; webhookSecret: string } | null, LinearError>>;

  /** Update webhook secret for a user's connection */
  updateWebhookSecret(userId: string, webhookSecret: string | null): Promise<Result<void, LinearError>>;
}

/** Repository for failed issue creations */
export interface FailedIssueRepository {
  /** Save a failed issue for review */
  create(input: {
    userId: string;
    actionId: string;
    originalText: string;
    extractedTitle: string | null;
    extractedPriority: number | null;
    error: string;
    reasoning: string | null;
  }): Promise<Result<FailedLinearIssue, LinearError>>;

  /** List failed issues for a user */
  listByUser(userId: string): Promise<Result<FailedLinearIssue[], LinearError>>;

  /** Get a failed issue by ID */
  getById(id: string): Promise<Result<FailedLinearIssue, LinearError>>;

  /** Update error message and retry timestamp (used after failed retry) */
  update(
    id: string,
    input: { error: string; lastRetryAt: string }
  ): Promise<Result<void, LinearError>>;

  /** Delete a failed issue (after resolution) */
  delete(id: string): Promise<Result<void, LinearError>>;
}

/** Client for Linear API operations */
export interface LinearApiClient {
  /** Validate an API key and return available teams */
  validateAndGetTeams(apiKey: string): Promise<Result<LinearTeam[], LinearError>>;

  /** Create a new issue */
  createIssue(apiKey: string, input: CreateIssueInput): Promise<Result<LinearIssue, LinearError>>;

  /** List issues for a team */
  listIssues(
    apiKey: string,
    teamId: string,
    options?: {
      /** Include completed issues from last N days */
      completedSinceDays?: number;
    }
  ): Promise<Result<LinearIssue[], LinearError>>;

  /** Get a single issue by ID */
  getIssue(apiKey: string, issueId: string): Promise<Result<LinearIssue | null, LinearError>>;

  /** Get a single issue by identifier (e.g., "INT-123") with team ID for validation */
  getIssueByIdentifier(
    apiKey: string,
    identifier: string
  ): Promise<Result<LinearIssueWithTeam | null, LinearError>>;

  /** Update an issue's workflow state */
  updateIssueState(
    apiKey: string,
    issueId: string,
    stateId: string
  ): Promise<Result<LinearIssue, LinearError>>;

  /** Get workflow states for a team */
  getWorkflowStates(
    apiKey: string,
    teamId: string
  ): Promise<Result<WorkflowState[], LinearError>>;
}

/** Service for extracting issue data from natural language */
export interface LinearActionExtractionService {
  /** Extract issue data from user message */
  extractIssue(userId: string, text: string): Promise<Result<ExtractedIssueData, LinearError>>;
}

/** Repository for tracking successfully processed actions (idempotency) */
export interface ProcessedActionRepository {
  /** Get a processed action by actionId */
  getByActionId(actionId: string): Promise<Result<ProcessedAction | null, LinearError>>;

  /** Save a successfully processed action */
  create(input: {
    actionId: string;
    userId: string;
    issueId: string;
    issueIdentifier: string;
    resourceUrl: string;
  }): Promise<Result<ProcessedAction, LinearError>>;
}

/** Repository for locally synced Linear issues */
export interface LinearIssueRepository {
  /** Save or update a synced issue */
  save(issue: SyncedLinearIssue): Promise<Result<SyncedLinearIssue, LinearError>>;

  /** Find issue by Linear UUID */
  findById(id: string): Promise<Result<SyncedLinearIssue | null, LinearError>>;

  /** Find issue by identifier (e.g., INT-444) */
  findByIdentifier(identifier: string): Promise<Result<SyncedLinearIssue | null, LinearError>>;

  /** List all issues for a user */
  listByUserId(userId: string): Promise<Result<SyncedLinearIssue[], LinearError>>;

  /** Delete issue by ID */
  deleteById(id: string): Promise<Result<void, LinearError>>;
}
