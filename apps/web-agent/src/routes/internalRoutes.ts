import type { FastifyPluginCallback } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { LinkPreviewResult } from '../domain/index.js';
import { OpenGraphFetcher } from '../infra/index.js';
import {
  fetchLinkPreviewsBodySchema,
  fetchLinkPreviewsResponseSchema,
  type FetchLinkPreviewsBody,
} from './schemas/index.js';

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: FetchLinkPreviewsBody }>(
    '/internal/link-previews',
    {
      schema: {
        operationId: 'fetchLinkPreviewsInternal',
        summary: 'Fetch link previews for URLs (internal)',
        description:
          'Internal endpoint for fetching Open Graph metadata from URLs. Supports partial success.',
        tags: ['internal'],
        body: fetchLinkPreviewsBodySchema,
        response: {
          200: fetchLinkPreviewsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/link-previews',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for link previews');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { urls, timeoutMs } = request.body;
      const startTime = Date.now();

      request.log.info(
        { urlCount: urls.length, timeoutMs: timeoutMs ?? 5000 },
        'Processing link preview request'
      );

      const { linkPreviewFetcher } = getServices();

      const fetcher =
        timeoutMs !== undefined
          ? new OpenGraphFetcher({ timeoutMs })
          : (linkPreviewFetcher as OpenGraphFetcher);

      const results: LinkPreviewResult[] = [];
      let successCount = 0;
      let failedCount = 0;

      const fetchPromises = urls.map(async (url): Promise<LinkPreviewResult> => {
        if (!isValidUrl(url)) {
          return {
            url,
            status: 'failed',
            error: {
              code: 'INVALID_URL',
              message: 'Invalid URL format or unsupported protocol',
            },
          };
        }

        const result = await fetcher.fetchPreview(url);

        if (result.ok) {
          return {
            url,
            status: 'success',
            preview: result.value,
          };
        }

        return {
          url,
          status: 'failed',
          error: result.error,
        };
      });

      const fetchResults = await Promise.all(fetchPromises);

      for (const result of fetchResults) {
        results.push(result);
        if (result.status === 'success') {
          successCount++;
        } else {
          failedCount++;
        }
      }

      const durationMs = Date.now() - startTime;

      request.log.info(
        { successCount, failedCount, durationMs },
        'Link preview fetch completed'
      );

      return await reply.ok({
        results,
        metadata: {
          requestedCount: urls.length,
          successCount,
          failedCount,
          durationMs,
        },
      });
    }
  );

  done();
};
