import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  ConfirmPartialFailureResponse,
  CreateResearchRequest,
  ListResearchesResponse,
  PartialFailureDecision,
  Research,
  SaveDraftRequest,
  SupportedModel,
} from './llmOrchestratorApi.types.js';

/**
 * Create a new research.
 */
export async function createResearch(
  accessToken: string,
  request: CreateResearchRequest
): Promise<Research> {
  return await apiRequest<Research>(config.llmOrchestratorUrl, '/research', accessToken, {
    method: 'POST',
    body: request,
  });
}

/**
 * Save a research as draft with auto-generated title.
 */
export async function saveDraft(
  accessToken: string,
  request: SaveDraftRequest
): Promise<{ id: string }> {
  return await apiRequest<{ id: string }>(
    config.llmOrchestratorUrl,
    '/research/draft',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
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

  return await apiRequest<ListResearchesResponse>(config.llmOrchestratorUrl, path, accessToken);
}

/**
 * Get a single research by ID.
 */
export async function getResearch(accessToken: string, id: string): Promise<Research> {
  return await apiRequest<Research>(config.llmOrchestratorUrl, `/research/${id}`, accessToken);
}

/**
 * Update a draft research.
 */
export async function updateDraft(
  accessToken: string,
  id: string,
  request: SaveDraftRequest
): Promise<Research> {
  return await apiRequest<Research>(config.llmOrchestratorUrl, `/research/${id}`, accessToken, {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Approve a draft research and start processing.
 */
export async function approveResearch(accessToken: string, id: string): Promise<Research> {
  return await apiRequest<Research>(
    config.llmOrchestratorUrl,
    `/research/${id}/approve`,
    accessToken,
    { method: 'POST' }
  );
}

/**
 * Delete a research by ID.
 */
export async function deleteResearch(accessToken: string, id: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.llmOrchestratorUrl,
    `/research/${id}`,
    accessToken,
    { method: 'DELETE' }
  );
}

/**
 * Confirm partial failure action (proceed, retry, or cancel).
 */
export async function confirmPartialFailure(
  accessToken: string,
  id: string,
  action: PartialFailureDecision
): Promise<ConfirmPartialFailureResponse> {
  return await apiRequest<ConfirmPartialFailureResponse>(
    config.llmOrchestratorUrl,
    `/research/${id}/confirm`,
    accessToken,
    {
      method: 'POST',
      body: { action },
    }
  );
}

/**
 * Retry a failed research by re-running failed LLMs or synthesis.
 */
export async function retryFromFailed(accessToken: string, id: string): Promise<Research> {
  return await apiRequest<Research>(
    config.llmOrchestratorUrl,
    `/research/${id}/retry`,
    accessToken,
    { method: 'POST' }
  );
}

/**
 * Remove public share access for a research.
 */
export async function unshareResearch(accessToken: string, id: string): Promise<void> {
  await apiRequest<null>(config.llmOrchestratorUrl, `/research/${id}/share`, accessToken, {
    method: 'DELETE',
  });
}

/**
 * Validate research input quality.
 */
export async function validateInput(
  accessToken: string,
  request: { prompt: string; includeImprovement?: boolean }
): Promise<{ quality: 0 | 1 | 2; reason: string; improvedPrompt: string | null }> {
  return await apiRequest<{ quality: 0 | 1 | 2; reason: string; improvedPrompt: string | null }>(
    config.llmOrchestratorUrl,
    '/research/validate-input',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

/**
 * Improve research input prompt.
 */
export async function improveInput(
  accessToken: string,
  request: { prompt: string }
): Promise<{ improvedPrompt: string }> {
  return await apiRequest<{ improvedPrompt: string }>(
    config.llmOrchestratorUrl,
    '/research/improve-input',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export interface EnhanceResearchRequest {
  additionalModels?: SupportedModel[];
  additionalContexts?: { content: string; label?: string }[];
  synthesisModel?: SupportedModel;
  removeContextIds?: string[];
}

/**
 * Create an enhanced research from a completed one.
 */
export async function enhanceResearch(
  accessToken: string,
  id: string,
  request: EnhanceResearchRequest
): Promise<Research> {
  return await apiRequest<Research>(
    config.llmOrchestratorUrl,
    `/research/${id}/enhance`,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export type {
  ConfirmPartialFailureResponse,
  CreateResearchRequest,
  ImproveInputRequest,
  ImproveInputResponse,
  ListResearchesResponse,
  LlmProvider,
  LlmResult,
  PartialFailure,
  PartialFailureDecision,
  Research,
  ResearchStatus,
  SaveDraftRequest,
  SupportedModel,
  ValidateInputRequest,
  ValidateInputResponse,
} from './llmOrchestratorApi.types.js';
