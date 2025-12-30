import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  Research,
  CreateResearchRequest,
  ListResearchesResponse,
} from './llmOrchestratorApi.types.js';

/**
 * Create a new research.
 */
export async function createResearch(
  accessToken: string,
  request: CreateResearchRequest
): Promise<Research> {
  return await apiRequest<Research>(config.llmOrchestratorServiceUrl, '/research', accessToken, {
    method: 'POST',
    body: request,
  });
}

/**
 * List researches for the current user.
 */
export async function listResearches(
  accessToken: string,
  cursor?: string,
  limit = 50
): Promise<ListResearchesResponse> {
  const params = new URLSearchParams();
  if (cursor !== undefined && cursor !== '') {
    params.set('cursor', cursor);
  }
  params.set('limit', String(limit));

  const query = params.toString();
  const path = query !== '' ? `/research?${query}` : '/research';

  return await apiRequest<ListResearchesResponse>(
    config.llmOrchestratorServiceUrl,
    path,
    accessToken
  );
}

/**
 * Get a single research by ID.
 */
export async function getResearch(accessToken: string, id: string): Promise<Research> {
  return await apiRequest<Research>(
    config.llmOrchestratorServiceUrl,
    `/research/${id}`,
    accessToken
  );
}

/**
 * Delete a research by ID.
 */
export async function deleteResearch(accessToken: string, id: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.llmOrchestratorServiceUrl,
    `/research/${id}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export type {
  LlmProvider,
  ResearchStatus,
  LlmResult,
  Research,
  CreateResearchRequest,
  ListResearchesResponse,
} from './llmOrchestratorApi.types.js';
