import type { UsageLogParams } from './usageLogger.js';

/**
 * Optional correlation overrides to populate task/session context in events.
 * Sinks that have access to per-call context (e.g. task ID from orchestrator)
 * pass these overrides to enrich event correlation fields.
 */
export interface CorrelationOverrides {
  taskId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  researchId?: string | null;
}

/**
 * Structural payload produced by buildUsageEvent — intentionally opaque
 * (`Record<string, unknown>`) to break the circular type reference with
 * @intexuraos/internal-clients' UsageEventInput. Sinks only JSON.stringify
 * the result, so no field-level access is needed at this layer; shape is
 * validated by the receiving service's Zod schema.
 *
 * @internal
 */
export type UsageEventPayload = Record<string, unknown>;

/**
 * Shared helper that maps UsageLogParams to a usage event payload.
 * Used by both HttpWebhookUsageSink and HttpInternalAuthUsageSink to avoid duplication.
 *
 * Schema v2: clients emit raw token counts; llm-usage-service computes costs on ingestion.
 *
 * @internal
 */
export function buildUsageEvent(
  params: UsageLogParams,
  source: { service: string; component: string },
  correlationOverrides?: CorrelationOverrides
): UsageEventPayload {
  const environment: 'dev' | 'prod' = process.env['NODE_ENV'] === 'production' ? 'prod' : 'dev';

  const ownerType = params.ownerType ?? 'system';
  const clientName = params.clientName ?? source.component;
  const providerReportedUsd = params.providerReportedUsd ?? null;
  const useProviderCost = providerReportedUsd !== null;

  return {
    schemaVersion: 2,
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    owner: { type: ownerType, id: params.userId },
    source: {
      service: source.service,
      component: source.component,
      client: clientName,
      environment,
    },
    request: {
      provider: params.provider,
      model: params.model,
      operation: params.callType,
      success: params.success,
      durationMs: params.durationMs,
      ...(params.promptType !== undefined && { promptType: params.promptType }),
    },
    usage: {
      inputTokens: params.usage.inputTokens,
      outputTokens: params.usage.outputTokens,
      totalTokens: params.usage.totalTokens,
      cacheReadTokens: params.usage.cacheTokens ?? 0,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      reasoningTokens: params.usage.reasoningTokens ?? 0,
      thinkingTokens: params.usage.thinkingTokens ?? 0,
      webSearchCalls: params.usage.webSearchCalls ?? 0,
      groundingEnabled: params.usage.groundingEnabled ?? false,
      imageCount: params.usage.imageCount ?? 0,
      ...(params.usage.imageSize !== undefined && { imageSize: params.usage.imageSize }),
    },
    cost: {
      providerReportedUsd,
      pricingSource: useProviderCost ? 'provider_reported' : 'pending',
    },
    correlation: {
      requestId: correlationOverrides?.requestId ?? null,
      traceId: null,
      taskId: correlationOverrides?.taskId ?? null,
      researchId: correlationOverrides?.researchId ?? null,
      attempt: null,
      sessionId: correlationOverrides?.sessionId ?? null,
    },
    error: params.success ? null : { code: null, message: params.errorMessage ?? null },
  };
}
