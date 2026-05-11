import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  WebAgentFetchLinkPreviewsData,
  WebAgentSummarizePageData,
} from '@intexuraos/http-contracts';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
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
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async fetchPreview(
      url: string,
      options?: WebAgentRequestOptions
    ): Promise<Result<WebAgentLinkPreview, WebAgentLinkPreviewError>> {
      const result = await httpClient.request<WebAgentFetchLinkPreviewsData>({
        path: '/internal/link-previews',
        method: 'POST',
        body: { urls: [url] },
        timeoutMs: options?.timeoutMs ?? config.defaultTimeoutMs,
        requestId: options?.requestId,
      });

      if (
        !result.ok &&
        (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT')
      ) {
        return err({
          code: 'FETCH_FAILED',
          message: `Failed to call web-agent: ${result.error.message}`,
        });
      }

      if (!result.ok && result.error.code === 'API_ERROR') {
        return err({
          code: 'FETCH_FAILED',
          message: `HTTP ${String(result.error.status)}: ${result.error.statusText}`,
        });
      }

      if (!result.ok) {
        if (result.error.code === 'ENVELOPE_ERROR') {
          const body = result.error.body as { error?: { message?: string } };
          return err({
            code: 'FETCH_FAILED',
            message: body.error?.message ?? 'Invalid response from web-agent',
          });
        }
        return err({
          code: 'FETCH_FAILED',
          message: 'Invalid response from web-agent',
        });
      }

      const previewResult = result.value.results[0];
      if (previewResult === undefined) {
        return err({ code: 'FETCH_FAILED', message: 'No results returned' });
      }

      if (previewResult.status === 'failed') {
        return err({
          code: mapErrorCode(previewResult.error?.code ?? 'FETCH_FAILED'),
          message: previewResult.error?.message ?? 'Unknown error',
        });
      }

      if (previewResult.preview === undefined) {
        return err({ code: 'FETCH_FAILED', message: 'No preview in successful result' });
      }

      return ok(previewResult.preview);
    },

    async summarizePage(
      request: WebAgentPageSummaryRequest,
      options?: WebAgentRequestOptions
    ): Promise<Result<WebAgentPageSummary, WebAgentPageSummaryError>> {
      const result = await httpClient.request<WebAgentSummarizePageData>({
        path: '/internal/page-summaries',
        method: 'POST',
        body: {
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

      if (
        !result.ok &&
        (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT')
      ) {
        return err({
          code: result.error.code === 'TIMEOUT' ? 'TIMEOUT' : 'FETCH_FAILED',
          message: `Failed to call web-agent: ${result.error.message}`,
          transient: true,
        });
      }

      if (!result.ok && result.error.code === 'API_ERROR') {
        return err({
          code: 'API_ERROR',
          message: `HTTP ${String(result.error.status)}: ${result.error.statusText}`,
          transient: isTransientHttpStatus(result.error.status),
        });
      }

      if (!result.ok) {
        if (result.error.code === 'ENVELOPE_ERROR') {
          const body = result.error.body as { error?: string };
          return err({
            code: 'API_ERROR',
            message: body.error ?? 'Invalid response from web-agent',
            transient: false,
          });
        }
        return err({
          code: 'API_ERROR',
          message: 'Invalid response from web-agent',
          transient: false,
        });
      }

      const summaryResult = result.value.result;
      if (summaryResult.status === 'failed') {
        const code = summaryResult.error?.code ?? 'API_ERROR';
        return err({
          code: normalizeSummaryErrorCode(code),
          message: summaryResult.error?.message ?? 'Unknown error',
          transient: isTransientErrorCode(code),
        });
      }

      if (summaryResult.summary === undefined) {
        return err({
          code: 'API_ERROR',
          message: 'No summary in successful result',
          transient: false,
        });
      }

      return ok(summaryResult.summary);
    },
  };
}
