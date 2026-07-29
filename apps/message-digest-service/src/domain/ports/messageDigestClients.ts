import type {
  MessageDigestAggregate,
  MessageDigestPreviousSummary,
  MessageDigestSourceMessage,
} from '@intexuraos/llm-prompts';

export interface ValidatedMessageDigestSource {
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: 'group' | 'direct';
  displayName: string;
  messageCount: number;
  participantCount?: number | undefined;
  lastActivityAt?: string | undefined;
  sourceRevision: string;
}

export interface MessageDigestDeliveryReadiness {
  status: 'ready' | 'mapping_missing' | 'disconnected' | 'delivery_disabled';
  maskedPrimaryNumber?: string | undefined;
  observationVersion: string;
  observedAt: string;
}

export type MessageDigestOutboundDeliveryState =
  | { status: 'pending' | 'missing' }
  | { status: 'sent'; acceptedAt: string }
  | { status: 'ambiguous'; acceptedAt?: string | undefined }
  | { status: 'failed'; failedAt: string; failureCode: string };

export interface QueryMessageDigestSourceInput {
  userId: string;
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: 'group' | 'direct';
  windowStart: string;
  windowEnd: string;
  limit: number;
  cursor?: string | undefined;
}

export interface MessageDigestSourcePage {
  messages: MessageDigestSourceMessage[];
  sourceRevision: string;
  highWatermark: string | null;
  nextCursor: string | null;
}

export type MessageDigestClientResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: 'invalid_request' | 'unavailable' | 'source_changed' | 'not_found' | 'invalid_response';
    };

export interface MessageDigestWhatsAppClient {
  validateSource(input: {
    userId: string;
    chatId: string;
    expectedGenerationId?: string | undefined;
  }): Promise<MessageDigestClientResult<ValidatedMessageDigestSource>>;
  getDeliveryReadiness(
    userId: string
  ): Promise<MessageDigestClientResult<MessageDigestDeliveryReadiness>>;
  getOutboundDeliveryState(input: {
    userId: string;
    idempotencyKey: string;
  }): Promise<MessageDigestClientResult<MessageDigestOutboundDeliveryState>>;
  authorizeOutboundDeliveryRetry(input: {
    userId: string;
    idempotencyKey: string;
    payloadDigest: string;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        code: 'invalid_request' | 'unavailable' | 'not_found' | 'invalid_response';
      }
  >;
  queryMessages(
    input: QueryMessageDigestSourceInput
  ): Promise<MessageDigestClientResult<MessageDigestSourcePage>>;
}

export interface MessageDigestAggregationInput {
  userId: string;
  correlationId: string;
  chatType: 'group' | 'direct';
  conversationLabel: string;
  windowStart: string;
  windowEnd: string;
  instructions: string;
  continuityMemoryMarkdown: string;
  previousSummaries: MessageDigestPreviousSummary[];
  messages: MessageDigestSourceMessage[];
}

export interface MessageDigestAggregationMetadata {
  effectiveMessageCount: number;
  promptVersion: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

export type MessageDigestAggregationResult =
  | {
      ok: true;
      kind: 'empty' | 'aggregate';
      aggregate: MessageDigestAggregate | null;
      metadata: MessageDigestAggregationMetadata;
    }
  | { ok: false; code: 'SOURCE_TOO_LARGE' | 'LLM_UNAVAILABLE' | 'INVALID_AGGREGATE' };

export interface MessageDigestAggregator {
  aggregate(input: MessageDigestAggregationInput): Promise<MessageDigestAggregationResult>;
}
