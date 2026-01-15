import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  LinearConnectionStatus,
  ListIssuesResponse,
  LinearTeam,
  ValidateLinearApiKeyResponse,
  SaveLinearConnectionRequest,
  SaveLinearConnectionResponse,
} from '@/types';

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
  } catch {
    return null;
  }
}

/**
 * Validate a Linear API key and return available teams
 */
export async function validateLinearApiKey(
  accessToken: string,
  apiKey: string
): Promise<LinearTeam[]> {
  const response = await apiRequest<ValidateLinearApiKeyResponse>(
    config.linearAgentUrl,
    '/linear/validate-api-key',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    }
  );
  return response.teams;
}

/**
 * Save Linear connection (API key and team)
 */
export async function saveLinearConnection(
  accessToken: string,
  request: SaveLinearConnectionRequest
): Promise<LinearConnectionStatus> {
  return await apiRequest<SaveLinearConnectionResponse>(
    config.linearAgentUrl,
    '/linear/connection',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(request),
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
