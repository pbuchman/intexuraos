import type { LlmProvider } from '@intexuraos/llm-contract';

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
  };

  request: {
    provider: LlmProvider;
    model: string;
    operation:
      | 'research'
      | 'generate'
      | 'image_generation'
      | 'tool_calling'
      | 'visualization_insights'
      | 'visualization_vegalite'
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

/** UsageEventInput - what callers send (no receivedAt, no ingress) */
export type UsageEventInput = Omit<UsageEvent, 'receivedAt' | 'ingress'>;

/** Ingest request */
export interface UsageIngestRequest {
  schemaVersion: 1;
  events: UsageEventInput[];
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
