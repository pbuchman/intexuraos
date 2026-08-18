import { config } from '@/config';
import { ApiError, apiRequest } from './apiClient.js';
import {
  DEFAULT_INTEX_AGENT_MODEL,
  IntexAgentModels,
  isIntexAgentModel,
} from '@intexuraos/llm-contract';
import type { IntexAgentModel } from '@intexuraos/llm-contract';
import type {
  IntexAgentModelPatchRequest,
  IntexAgentModelPatchResponse,
  IntexAgentModelSelectorV1,
  LlmKeysResponse,
  ConfigurableLlmProvider,
  LlmTestResult,
  SetLlmKeyRequest,
  SetLlmKeyResponse,
} from './llmKeysApi.types.js';

const SELECTOR_OPTION_TUPLE = [
  { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash' },
  { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3' },
  { id: IntexAgentModels.Gemini36Flash, label: 'Gemini 3.6 Flash' },
] as const;

function malformedResponse(): ApiError {
  return new ApiError('MALFORMED_RESPONSE', 'Received an invalid response', 502);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactlyOwnKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decodeModel(value: unknown): IntexAgentModel | null {
  if (value === null) return null;
  return isIntexAgentModel(value) ? value : null;
}

function decodeSelectorFields(value: Record<string, unknown>): Omit<IntexAgentModelPatchResponse, 'explicitModel'> & { explicitModel: IntexAgentModel | null } {
  if (!hasExactlyOwnKeys(value, ['explicitModel', 'effectiveModel', 'source', 'revision'])) {
    throw malformedResponse();
  }
  const explicitModel = decodeModel(value['explicitModel']);
  if ((value['explicitModel'] !== null && explicitModel === null) || !isIntexAgentModel(value['effectiveModel']) || !isSafeRevision(value['revision'])) {
    throw malformedResponse();
  }
  if (value['source'] === 'explicit') {
    if (explicitModel === null || explicitModel !== value['effectiveModel']) throw malformedResponse();
  } else if (value['source'] === 'default_absent') {
    if (explicitModel !== null || value['effectiveModel'] !== DEFAULT_INTEX_AGENT_MODEL) throw malformedResponse();
  } else {
    throw malformedResponse();
  }
  return {
    explicitModel,
    effectiveModel: value['effectiveModel'],
    source: value['source'],
    revision: value['revision'],
  };
}

function decodeSelector(value: unknown): IntexAgentModelSelectorV1 {
  if (!isPlainRecord(value)) throw malformedResponse();
  if (value['status'] === 'unavailable') {
    if (!hasExactlyOwnKeys(value, ['status'])) throw malformedResponse();
    return { status: 'unavailable' };
  }
  if (value['status'] !== 'available' || !hasExactlyOwnKeys(value, ['status', 'explicitModel', 'effectiveModel', 'source', 'revision', 'options'])) {
    throw malformedResponse();
  }
  const { explicitModel, effectiveModel, source, revision } = decodeSelectorFields({
    explicitModel: value['explicitModel'],
    effectiveModel: value['effectiveModel'],
    source: value['source'],
    revision: value['revision'],
  });
  if (!Array.isArray(value['options']) || value['options'].length !== SELECTOR_OPTION_TUPLE.length) throw malformedResponse();
  for (let index = 0; index < SELECTOR_OPTION_TUPLE.length; index += 1) {
    const option = value['options'][index];
    const expected = SELECTOR_OPTION_TUPLE[index];
    if (expected === undefined || !isPlainRecord(option) || !hasExactlyOwnKeys(option, ['id', 'label']) || option['id'] !== expected.id || option['label'] !== expected.label) {
      throw malformedResponse();
    }
  }
  return {
    status: 'available',
    explicitModel,
    effectiveModel,
    source,
    revision,
    options: SELECTOR_OPTION_TUPLE,
  };
}

function decodePatchResponse(value: unknown): IntexAgentModelPatchResponse {
  if (!isPlainRecord(value)) throw malformedResponse();
  return decodeSelectorFields(value);
}

/**
 * Get user's LLM API keys (masked values).
 */
export async function getLlmKeys(accessToken: string, userId: string): Promise<LlmKeysResponse> {
  const response = await apiRequest<unknown>(
    config.authServiceUrl,
    `/users/${userId}/settings/llm-keys`,
    accessToken
  );
  if (!isPlainRecord(response) || !Object.hasOwn(response, 'intexAgentModelSelector')) {
    throw malformedResponse();
  }
  return {
    ...(response as Omit<LlmKeysResponse, 'intexAgentModelSelector'>),
    intexAgentModelSelector: decodeSelector(response['intexAgentModelSelector']),
  };
}

export async function updateIntexAgentModel(
  accessToken: string,
  userId: string,
  intexAgentModel: IntexAgentModel | null,
  expectedRevision: number,
  signal?: AbortSignal
): Promise<IntexAgentModelPatchResponse> {
  const request: IntexAgentModelPatchRequest = { intexAgentModel, expectedRevision };
  const options = signal === undefined
    ? { method: 'PATCH' as const, body: request }
    : { method: 'PATCH' as const, body: request, signal };
  const response = await apiRequest<unknown>(
    config.authServiceUrl,
    `/users/${encodeURIComponent(userId)}/settings`,
    accessToken,
    options
  );
  return decodePatchResponse(response);
}

/**
 * Set or update an LLM API key.
 */
export async function setLlmKey(
  accessToken: string,
  userId: string,
  request: SetLlmKeyRequest
): Promise<SetLlmKeyResponse> {
  return await apiRequest<SetLlmKeyResponse>(
    config.authServiceUrl,
    `/users/${userId}/settings/llm-keys`,
    accessToken,
    {
      method: 'PATCH',
      body: request,
    }
  );
}

/**
 * Delete an LLM API key.
 */
export async function deleteLlmKey(
  accessToken: string,
  userId: string,
  provider: ConfigurableLlmProvider
): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.authServiceUrl,
    `/users/${userId}/settings/llm-keys/${provider}`,
    accessToken,
    { method: 'DELETE' }
  );
}

/**
 * Update the user's LLM preferences (default model and optional fallback model).
 */
export async function updateLlmPreferences(
  accessToken: string,
  userId: string,
  defaultModel: string,
  fallbackModel?: string | null
): Promise<{ defaultModel: string; fallbackModel: string | null }> {
  return await apiRequest<{ defaultModel: string; fallbackModel: string | null }>(
    config.authServiceUrl,
    `/users/${userId}/settings`,
    accessToken,
    {
      method: 'PATCH',
      body: { defaultModel, ...(fallbackModel !== undefined ? { fallbackModel } : {}) },
    }
  );
}

/**
 * Test an LLM API key with a sample prompt.
 */
export async function testLlmKey(
  accessToken: string,
  userId: string,
  provider: ConfigurableLlmProvider
): Promise<LlmTestResult> {
  return await apiRequest<LlmTestResult>(
    config.authServiceUrl,
    `/users/${userId}/settings/llm-keys/${provider}/test`,
    accessToken,
    { method: 'POST' }
  );
}

export type {
  IntexAgentModelPatchRequest,
  IntexAgentModelPatchResponse,
  IntexAgentModelSelectorV1,
  ConfigurableLlmProvider,
  LlmKeysResponse,
  LlmTestResult,
  SetLlmKeyRequest,
  SetLlmKeyResponse,
} from './llmKeysApi.types.js';
