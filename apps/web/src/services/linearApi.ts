import { config } from '@/config';
import { apiRequest, ApiError } from './apiClient.js';
import type {
  LinearConnectionStatus,
  ListIssuesResponse,
  LinearTeam,
  FailedLinearIssue,
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

export type { ValidateResponse, SaveConnectionRequest };
