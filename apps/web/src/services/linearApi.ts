import { config } from '@/config';
import { apiRequest, ApiError } from './apiClient.js';
import type {
  LinearConnectionStatus,
  ListIssuesResponse,
  LinearTeam,
  FailedLinearIssue,
  LinearWebhookConfig,
} from '@/types';

interface ValidateResponse {
  teams: LinearTeam[];
}

interface SaveConnectionRequest {
  apiKey: string;
  teamId: string;
  teamName: string;
}

/**
 * Get the current Linear connection status
 */
export async function getLinearConnection(
  accessToken: string
): Promise<LinearConnectionStatus | null> {
  try {
    return await apiRequest<LinearConnectionStatus>(
      config.linearAgentUrl,
      '/linear/connection',
      accessToken
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      return null;
    }
    throw e;
  }
}

/**
 * Validate a Linear API key and return available teams
 */
export async function validateLinearApiKey(
  accessToken: string,
  apiKey: string
): Promise<LinearTeam[]> {
  const response = await apiRequest<ValidateResponse>(
    config.linearAgentUrl,
    '/linear/connection/validate',
    accessToken,
    {
      method: 'POST',
      body: { apiKey },
    }
  );
  return response.teams;
}

/**
 * Save Linear connection (API key and team)
 */
export async function saveLinearConnection(
  accessToken: string,
  request: SaveConnectionRequest
): Promise<LinearConnectionStatus> {
  return await apiRequest<LinearConnectionStatus>(
    config.linearAgentUrl,
    '/linear/connection',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

/**
 * Disconnect Linear integration
 */
export async function disconnectLinear(
  accessToken: string
): Promise<LinearConnectionStatus> {
  return await apiRequest<LinearConnectionStatus>(
    config.linearAgentUrl,
    '/linear/connection',
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

/**
 * List Linear issues grouped by state
 */
export async function listLinearIssues(
  accessToken: string,
  includeArchive = true
): Promise<ListIssuesResponse> {
  const query = includeArchive ? '?includeArchive=true' : '';
  return await apiRequest<ListIssuesResponse>(
    config.linearAgentUrl,
    `/linear/issues${query}`,
    accessToken
  );
}

interface ListFailedIssuesResponse {
  failedIssues: FailedLinearIssue[];
}

/**
 * List failed Linear issue extractions for manual review
 */
export async function listFailedLinearIssues(
  accessToken: string
): Promise<FailedLinearIssue[]> {
  const response = await apiRequest<ListFailedIssuesResponse>(
    config.linearAgentUrl,
    '/linear/failed-issues',
    accessToken
  );
  return response.failedIssues;
}

export async function deleteFailedIssue(
  accessToken: string,
  id: string
): Promise<void> {
  await apiRequest<Record<string, never>>(
    config.linearAgentUrl,
    `/linear/failed-issues/${id}`,
    accessToken,
    { method: 'DELETE' }
  );
}

interface RetryFailedIssueResponse {
  issue: { id: string; identifier: string; url: string };
}

export async function retryFailedIssue(
  accessToken: string,
  id: string
): Promise<RetryFailedIssueResponse> {
  return await apiRequest<RetryFailedIssueResponse>(
    config.linearAgentUrl,
    `/linear/failed-issues/${id}/retry`,
    accessToken,
    { method: 'POST' }
  );
}

/**
 * Validate that a Linear issue exists and belongs to the user's team
 */
export async function validateLinearIssue(
  accessToken: string,
  identifier: string,
  userId: string
): Promise<{ id: string; identifier: string; title: string; url: string }> {
  return await apiRequest(
    config.linearAgentUrl,
    `/internal/linear/issues/${encodeURIComponent(identifier)}?userId=${encodeURIComponent(userId)}`,
    accessToken
  );
}

/**
 * Generate an issue title from a description using LLM
 */
export async function generateLinearIssueTitle(
  accessToken: string,
  description: string,
  userId: string
): Promise<{ title: string; issueType: 'feature' | 'bug' | 'refactor' | 'research' }> {
  return await apiRequest(
    config.linearAgentUrl,
    '/internal/linear/issues/generate-title',
    accessToken,
    {
      method: 'POST',
      body: { description, userId },
    }
  );
}

interface SyncFromLinearResponse {
  created: number;
  updated: number;
  deleted: number;
  total: number;
  durationMs: number;
  syncedAt: string;
}

/**
 * Trigger a full sync from Linear
 * Fetches all issues from the user's Linear team and updates local storage
 */
export async function syncFromLinear(
  accessToken: string
): Promise<SyncFromLinearResponse> {
  return await apiRequest<SyncFromLinearResponse>(
    config.linearAgentUrl,
    '/linear/sync',
    accessToken,
    { method: 'POST' }
  );
}

interface WebhookConfigSaveResponse {
  configured: boolean;
}

/**
 * Get webhook configuration (URL and secret status)
 */
export async function getWebhookConfig(
  accessToken: string
): Promise<LinearWebhookConfig> {
  return await apiRequest<LinearWebhookConfig>(
    config.linearAgentUrl,
    '/linear/webhook-config',
    accessToken
  );
}

/**
 * Save or update webhook signing secret
 */
export async function saveWebhookSecret(
  accessToken: string,
  secret: string
): Promise<WebhookConfigSaveResponse> {
  return await apiRequest<WebhookConfigSaveResponse>(
    config.linearAgentUrl,
    '/linear/webhook-config',
    accessToken,
    {
      method: 'POST',
      body: { secret },
    }
  );
}

/**
 * Remove webhook signing secret
 */
export async function removeWebhookSecret(
  accessToken: string
): Promise<WebhookConfigSaveResponse> {
  return await apiRequest<WebhookConfigSaveResponse>(
    config.linearAgentUrl,
    '/linear/webhook-config',
    accessToken,
    { method: 'DELETE' }
  );
}

/** Prune candidate from Gemini classification */
export interface PruneCandidateResponse {
  id: string;
  identifier: string;
  title: string;
  score: number;
  reason: string;
  category: 'cancelled' | 'duplicate' | 'sub-issue' | 'simple-fix' | 'review-only' | 'other';
  classifiedAt: string;
}

interface ListPruneCandidatesResponse {
  candidates: PruneCandidateResponse[];
}

/**
 * List all issues scheduled for deletion
 */
export async function listPruneCandidates(
  accessToken: string
): Promise<PruneCandidateResponse[]> {
  const response = await apiRequest<ListPruneCandidatesResponse>(
    config.linearAgentUrl,
    '/linear/prune-candidates',
    accessToken
  );
  return response.candidates;
}

interface DeletePruneCandidatesResponse {
  deleted: number;
  failedDeletions: { identifier: string; error: string }[];
  durationMs: number;
}

/**
 * Delete all scheduled prune candidates from Linear
 */
export async function deletePruneCandidates(
  accessToken: string
): Promise<DeletePruneCandidatesResponse> {
  return await apiRequest<DeletePruneCandidatesResponse>(
    config.linearAgentUrl,
    '/linear/prune-candidates',
    accessToken,
    { method: 'DELETE' }
  );
}

export type { ValidateResponse, SaveConnectionRequest };
