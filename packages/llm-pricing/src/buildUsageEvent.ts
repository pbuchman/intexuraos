// IMPORTANT: Must remain `import type` — @intexuraos/internal-clients is a devDependency (type-checking only).
import type { UsageEventInput } from '@intexuraos/internal-clients';
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
 * Shared helper that maps UsageLogParams to a UsageEventInput payload.
 * Used by both HttpWebhookUsageSink and HttpInternalAuthUsageSink to avoid duplication.
 *
 * @internal
 */
export function buildUsageEvent(
  params: UsageLogParams,
  source: { service: string; component: string },
  correlationOverrides?: CorrelationOverrides
): UsageEventInput {
  const environment: 'dev' | 'prod' = process.env['NODE_ENV'] === 'production' ? 'prod' : 'dev';

  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    owner: { type: 'system', id: params.userId },
    source: {
      service: source.service,
      component: source.component,
      client: params.model,
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
      billedUsd: params.usage.costUsd,
      providerReportedUsd: null,
      calculatedUsd: params.usage.costUsd,
      pricingSource: 'calculated',
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
