/**
 * Ports (interfaces) for Linear integration.
 * These define contracts for infrastructure adapters.
 */

import type { Result } from '@intexuraos/common-core';
import type {
  LinearConnection,
  LinearConnectionPublic,
  LinearIssue,
  LinearTeam,
  CreateIssueInput,
  FailedLinearIssue,
  ExtractedIssueData,
  ProcessedAction,
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
