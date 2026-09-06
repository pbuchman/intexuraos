import { getErrorMessage } from '@intexuraos/common-core';
import type { LLMError, NormalizedUsage } from '@intexuraos/llm-contract';

const API_BASE_URL = 'https://openrouter.ai/api/v1';
const APP_TITLE = 'IntexuraOS';

export class OpenRouterModalityHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'OpenRouterModalityHttpError';
  }
}

export async function postOpenRouterModalityJson(
  path: '/embeddings' | '/images',
  apiKey: string,
  requestBody: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://intexuraos.cloud',
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new OpenRouterModalityHttpError(response.status, await response.text());
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export function mapOpenRouterModalityError(error: unknown): LLMError {
  if (error instanceof OpenRouterModalityHttpError) {
    if (error.status === 401) return { code: 'INVALID_KEY', message: error.message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message: error.message };
    if (error.status >= 500) return { code: 'OVERLOADED', message: error.message };
    return { code: 'API_ERROR', message: error.message };
  }
  const message = getErrorMessage(error);
  if (
    (error instanceof Error && error.name === 'AbortError') ||
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('aborted')
  ) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}

export function toOpenRouterModalityErrorCategory(error: unknown): string {
  if (error instanceof OpenRouterModalityHttpError) {
    return `OPENROUTER_HTTP_${String(error.status)}`;
  }
  const mapped = mapOpenRouterModalityError(error);
  return mapped.code === 'TIMEOUT' ? 'OPENROUTER_TIMEOUT' : 'OPENROUTER_CLIENT_ERROR';
}

export function nonNegativeProviderCost(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeModalityUsage(input: {
  promptTokens: unknown;
  completionTokens?: unknown;
  totalTokens: unknown;
  providerReportedUsd: number | null;
}): NormalizedUsage {
  const inputTokens = toNonNegativeInteger(input.promptTokens);
  const outputTokens = toNonNegativeInteger(input.completionTokens);
  const providerTotal = toNonNegativeInteger(input.totalTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: providerTotal > 0 ? providerTotal : inputTokens + outputTokens,
    costUsd: input.providerReportedUsd ?? 0,
  };
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
