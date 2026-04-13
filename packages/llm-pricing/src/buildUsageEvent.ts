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
  // Schema requires billedUsd >= 0; clamp defensively so a misbehaving provider can't 400 the receiver.
  const billedUsd = useProviderCost
    ? Math.max(0, providerReportedUsd)
    : params.usage.costUsd;
  const pricingSource = useProviderCost ? 'provider_reported' : 'calculated';

  return {
    schemaVersion: 1,
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
      durationMs: 0, // Not tracked at the UsageLogParams level; NormalizedUsage carries token counts only
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
      imageCount: 0,
    },
    cost: {
      billedUsd,
      providerReportedUsd,
      calculatedUsd: params.usage.costUsd,
      pricingSource,
    },
    correlation: {
      requestId: correlationOverrides?.requestId ?? null,
      traceId: null,
      taskId: correlationOverrides?.taskId ?? null,
      researchId: null,
      attempt: null,
      sessionId: correlationOverrides?.sessionId ?? null,
    },
    error: params.success ? null : { code: null, message: params.errorMessage ?? null },
  };
}
