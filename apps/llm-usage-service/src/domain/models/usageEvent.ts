import type { LlmProvider } from '@intexuraos/llm-contract';

export const MAX_LIST_LIMIT = 200;
export const DEFAULT_LIST_LIMIT = 50;

/** UsageEvent - canonical stored event */
export interface UsageEvent {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  receivedAt: string;
  ingress: 'internal' | 'orchestrator_webhook';

  owner: {
    type: 'user' | 'system';
    id: string;
  };

  source: {
    service: string;
    component: string;
    client: string;
    environment: 'dev' | 'prod' | 'test';
    /**
     * Physical location identifier of the orchestrator that produced this event
     * (e.g. 'home-dev', 'mac-dev', 'office-pc'). Required at the webhook endpoint
     * (enforced by OrchestratorUsageEventInput schema); optional on the internal endpoint.
     */
    workerLocation?: string;
  };

  request: {
    provider: LlmProvider;
    model: string;
    operation:
      | 'research'
      | 'generate'
      | 'image_generation'
      | 'tool_calling'
      | 'other';
    success: boolean;
    durationMs: number;
  };

  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    thinkingTokens: number;
    webSearchCalls: number;
    groundingEnabled: boolean;
    imageCount: number;
  };

  cost: {
    billedUsd: number;
    providerReportedUsd: number | null;
    calculatedUsd: number | null;
    pricingSource: 'provider_reported' | 'calculated' | 'mixed' | 'external';
  };

  correlation: {
    requestId: string | null;
    traceId: string | null;
    taskId: string | null;
    researchId: string | null;
    attempt: number | null;
    sessionId: string | null;
  };

  error: {
    code: string | null;
    message: string | null;
  } | null;
}

/** UsageEventInput - what v1 callers send (no receivedAt, no ingress) */
export type UsageEventInput = Omit<UsageEvent, 'receivedAt' | 'ingress'>;

/** UsageEventInputV2 - what v2 callers send (cost has only providerReportedUsd + pending/provider_reported pricingSource) */
export type UsageEventInputV2 = Omit<
  UsageEvent,
  'receivedAt' | 'ingress' | 'schemaVersion' | 'cost'
> & {
  schemaVersion: 2;
  cost: {
    providerReportedUsd: number | null;
    pricingSource: 'pending' | 'provider_reported';
  };
};

/** Discriminated union of all input event versions */
export type UsageEventInputAny = UsageEventInput | UsageEventInputV2;

/** Ingest request */
export interface UsageIngestRequest {
  schemaVersion: 1 | 2;
  events: UsageEventInputAny[];
}

/** Ingest response */
export interface UsageIngestResponse {
  accepted: number;
  duplicates: number;
  rejected: RejectedEvent[];
}

export interface RejectedEvent {
  index: number;
  code: string;
  message: string;
}
