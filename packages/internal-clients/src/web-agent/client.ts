import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  WebAgentFetchLinkPreviewsData,
  WebAgentSummarizePageData,
} from '@intexuraos/http-contracts';
import { sendInternalRequest } from '../shared/request.js';
import type {
  WebAgentPageSummary,
  WebAgentPageSummaryError,
  WebAgentPageSummaryRequest,
  WebAgentLinkPreview,
  WebAgentLinkPreviewError,
  WebAgentRequestOptions,
  WebAgentServiceClient,
  WebAgentServiceConfig,
} from './types.js';

interface WebAgentPreviewEnvelope {
  success: boolean;
  data?: WebAgentFetchLinkPreviewsData;
  error?: { code?: string; message?: string };
}

interface WebAgentSummaryEnvelope {
  success: boolean;
  data?: WebAgentSummarizePageData;
  error?: string;
}

function mapErrorCode(code: string): WebAgentLinkPreviewError['code'] {
  switch (code) {
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'TOO_LARGE':
      return 'TOO_LARGE';
    case 'PARSE_FAILED':
      return 'PARSE_FAILED';
    default:
      return 'FETCH_FAILED';
  }
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}

function isTransientErrorCode(code: string): boolean {
  return code === 'TIMEOUT' || code === 'FETCH_FAILED' || code === 'RATE_LIMITED';
}

function normalizeSummaryErrorCode(code: string): WebAgentPageSummaryError['code'] {
  switch (code) {
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'TOO_LARGE':
      return 'TOO_LARGE';
    case 'INVALID_URL':
      return 'INVALID_URL';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'NO_CONTENT':
      return 'NO_CONTENT';
    case 'FETCH_FAILED':
      return 'FETCH_FAILED';
    default:
      return 'API_ERROR';
  }
}

export function createWebAgentServiceClient(config: WebAgentServiceConfig): WebAgentServiceClient {
  return {
    async fetchPreview(
      url: string,
      options?: WebAgentRequestOptions
    ): Promise<Result<WebAgentLinkPreview, WebAgentLinkPreviewError>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: '/internal/link-previews',
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        jsonBody: { urls: [url] },
        timeoutMs: options?.timeoutMs ?? config.defaultTimeoutMs,
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err({
          code: 'FETCH_FAILED',
          message: `Failed to call web-agent: ${transport.error.message}`,
        });
      }

      if (!transport.response.ok) {
        return err({
          code: 'FETCH_FAILED',
          message: `HTTP ${String(transport.response.status)}: ${transport.response.statusText}`,
        });
      }

      const body = transport.body as WebAgentPreviewEnvelope;
      if (!body.success || body.data === undefined) {
        return err({
          code: 'FETCH_FAILED',
          message: body.error?.message ?? 'Invalid response from web-agent',
        });
      }

      const result = body.data.results[0];
      if (result === undefined) {
        return err({ code: 'FETCH_FAILED', message: 'No results returned' });
      }

      if (result.status === 'failed') {
        return err({
          code: mapErrorCode(result.error?.code ?? 'FETCH_FAILED'),
          message: result.error?.message ?? 'Unknown error',
        });
      }

      if (result.preview === undefined) {
        return err({ code: 'FETCH_FAILED', message: 'No preview in successful result' });
      }

      return ok(result.preview);
    },

    async summarizePage(
      request: WebAgentPageSummaryRequest,
      options?: WebAgentRequestOptions
    ): Promise<Result<WebAgentPageSummary, WebAgentPageSummaryError>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: '/internal/page-summaries',
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        jsonBody: {
          url: request.url,
          userId: request.userId,
          ...(request.title !== undefined ? { title: request.title } : {}),
          ...(request.description !== undefined ? { description: request.description } : {}),
          ...(request.maxSentences !== undefined ? { maxSentences: request.maxSentences } : {}),
          ...(request.maxReadingMinutes !== undefined
            ? { maxReadingMinutes: request.maxReadingMinutes }
            : {}),
        },
        timeoutMs: options?.timeoutMs ?? config.defaultTimeoutMs,
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err({
          code: transport.error.code === 'TIMEOUT' ? 'TIMEOUT' : 'FETCH_FAILED',
          message: `Failed to call web-agent: ${transport.error.message}`,
          transient: true,
        });
      }

      if (!transport.response.ok) {
        return err({
          code: 'API_ERROR',
          message: `HTTP ${String(transport.response.status)}: ${transport.response.statusText}`,
          transient: isTransientHttpStatus(transport.response.status),
        });
      }

      const body = transport.body as WebAgentSummaryEnvelope;
      if (!body.success || body.data === undefined) {
        return err({
          code: 'API_ERROR',
          message: body.error ?? 'Invalid response from web-agent',
          transient: false,
        });
      }

      const result = body.data.result;
      if (result.status === 'failed') {
        const code = result.error?.code ?? 'API_ERROR';
        return err({
          code: normalizeSummaryErrorCode(code),
          message: result.error?.message ?? 'Unknown error',
          transient: isTransientErrorCode(code),
        });
      }

      if (result.summary === undefined) {
        return err({
          code: 'API_ERROR',
          message: 'No summary in successful result',
          transient: false,
        });
      }

      return ok(result.summary);
    },
  };
}
