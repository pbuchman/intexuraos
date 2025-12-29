import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  LLMResearch,
  LLMResearchListResponse,
  LLMResearchSubmitRequest,
  LLMResearchSubmitResponse,
  ApiKeyValidationRequest,
  ApiKeyValidationResponse,
} from '@/types';

export async function submitResearch(
  accessToken: string,
  request: LLMResearchSubmitRequest
): Promise<LLMResearchSubmitResponse> {
  return await apiRequest<LLMResearchSubmitResponse>(
    config.llmOrchestratorServiceUrl,
    '/research',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function getResearchList(
  accessToken: string,
  page = 1,
  limit = 50,
  sort: 'newest' | 'oldest' = 'newest'
): Promise<LLMResearchListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort,
  });
  return await apiRequest<LLMResearchListResponse>(
    config.llmOrchestratorServiceUrl,
    `/research?${params.toString()}`,
    accessToken
  );
}

export async function getResearch(accessToken: string, researchId: string): Promise<LLMResearch> {
  return await apiRequest<LLMResearch>(
    config.llmOrchestratorServiceUrl,
    `/research/${encodeURIComponent(researchId)}`,
    accessToken
  );
}

export async function deleteResearch(accessToken: string, researchId: string): Promise<void> {
  await apiRequest<undefined>(
    config.llmOrchestratorServiceUrl,
    `/research/${encodeURIComponent(researchId)}`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

export async function validateApiKey(
  accessToken: string,
  request: ApiKeyValidationRequest
): Promise<ApiKeyValidationResponse> {
  return await apiRequest<ApiKeyValidationResponse>(
    config.llmOrchestratorServiceUrl,
    '/api-keys/validate',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}
