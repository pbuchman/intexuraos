import type {
  InternalHttpClientError,
  InternalHttpClientLogger,
} from '../shared/createInternalHttpClient.js';

export interface MessageDigestServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export interface MessageDigestServiceRequestOptions {
  requestId?: string;
  timeoutMs?: number;
}

export type MessageDigestServiceClientError =
  | InternalHttpClientError
  | { code: 'INVALID_REQUEST'; message: string };

export type MessageDigestServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MessageDigestServiceClientError };

export interface QueryLegacyDigestDefinitionsInput {
  userId: string;
  legacyGroupKey: string;
}

export interface LegacyDigestDefinitionProjection {
  definitionId: string;
  legacyGroupKey: string;
  source: {
    sourceAccountId: string;
    generationId: string;
    chatId: string;
    chatType: 'group';
  };
  activeMigrationId: string;
}

export interface QueryLegacyDigestDefinitionsResponse {
  items: LegacyDigestDefinitionProjection[];
}

export interface QueryLegacyDigestRunsInput {
  userId: string;
  legacyGroupKey: string;
  fromDate?: string;
  toDate?: string;
  terms?: string[];
  limit: number;
  cursor?: string;
}

export interface LegacyDigestRunProjection {
  definitionId: string;
  runId: string;
  legacyGroupKey: string;
  date: string;
  title: string;
  summaryMarkdown: string;
  messageCount: number;
  evidenceMessageRefs: string[];
  windowStart: string;
  windowEnd: string;
}

export interface QueryLegacyDigestRunsResponse {
  items: LegacyDigestRunProjection[];
  truncated: boolean;
  nextCursor: string | null;
}

export interface MessageDigestServiceClient {
  queryLegacyDigestDefinitions(
    input: QueryLegacyDigestDefinitionsInput,
    options?: MessageDigestServiceRequestOptions
  ): Promise<MessageDigestServiceResult<QueryLegacyDigestDefinitionsResponse>>;

  queryLegacyDigestRuns(
    input: QueryLegacyDigestRunsInput,
    options?: MessageDigestServiceRequestOptions
  ): Promise<MessageDigestServiceResult<QueryLegacyDigestRunsResponse>>;
}
