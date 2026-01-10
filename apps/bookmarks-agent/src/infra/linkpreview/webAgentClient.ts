import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { OpenGraphPreview } from '../../domain/models/bookmark.js';
import type {
  LinkPreviewFetcherPort,
  LinkPreviewError,
} from '../../domain/ports/linkPreviewFetcher.js';
import pino, { type Logger } from 'pino';

export interface WebAgentClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger;
}

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'webAgentClient',
});

interface WebAgentPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
}

interface WebAgentResult {
  url: string;
  status: 'success' | 'failed';
  preview?: WebAgentPreview;
  error?: { code: string; message: string };
}

interface WebAgentApiResponse {
  success: boolean;
  data?: {
    results: WebAgentResult[];
    metadata: {
      requestedCount: number;
      successCount: number;
      failedCount: number;
      durationMs: number;
    };
  };
  error?: { code: string; message: string };
}

function mapErrorCode(
  code: string
): 'FETCH_FAILED' | 'PARSE_FAILED' | 'TIMEOUT' | 'TOO_LARGE' {
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

export function createWebAgentClient(config: WebAgentClientConfig): LinkPreviewFetcherPort {
  const logger = config.logger ?? defaultLogger;

  return {
    async fetchPreview(url: string): Promise<Result<OpenGraphPreview, LinkPreviewError>> {
      const endpoint = `${config.baseUrl}/internal/link-previews`;

      logger.info({ url }, 'Fetching link preview via web-agent');

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({ urls: [url] }),
        });
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call web-agent');
        return err({
          code: 'FETCH_FAILED',
          message: `Failed to call web-agent: ${getErrorMessage(error)}`,
        });
      }

      if (!response.ok) {
        logger.error(
          { httpStatus: response.status, statusText: response.statusText },
          'web-agent returned error'
        );
        return err({
          code: 'FETCH_FAILED',
          message: `HTTP ${String(response.status)}: ${response.statusText}`,
        });
      }

      const body = (await response.json()) as WebAgentApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from web-agent');
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
        const errorCode = mapErrorCode(result.error?.code ?? 'FETCH_FAILED');
        return err({
          code: errorCode,
          message: result.error?.message ?? 'Unknown error',
        });
      }

      if (result.preview === undefined) {
        return err({ code: 'FETCH_FAILED', message: 'No preview in successful result' });
      }

      logger.info({ url }, 'Link preview fetched successfully');

      const preview: OpenGraphPreview = {
        title: result.preview.title ?? null,
        description: result.preview.description ?? null,
        image: result.preview.image ?? null,
        siteName: result.preview.siteName ?? null,
        type: null,
        favicon: result.preview.favicon ?? null,
      };

      return ok(preview);
    },
  };
}
