import type { FastifyPluginCallback } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import type { Logger } from 'pino';
import { getServices } from '../services.js';
import type { LinkPreviewResult, PageSummaryResult } from '../domain/index.js';
import { OpenGraphFetcher } from '../infra/index.js';
import {
  fetchLinkPreviewsBodySchema,
  fetchLinkPreviewsResponseSchema,
  type FetchLinkPreviewsBody,
  summarizePageBodySchema,
  summarizePageResponseSchema,
  type SummarizePageBody,
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
          ? new OpenGraphFetcher({ timeoutMs }, request.log as unknown as Logger)
          : linkPreviewFetcher;

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

  fastify.post<{ Body: SummarizePageBody }>(
    '/internal/page-summaries',
    {
      schema: {
        operationId: 'summarizePageInternal',
        summary: 'Summarize a web page (internal)',
        description:
          'Internal endpoint for extracting and summarizing web page content using Crawl4AI and user\'s LLM.',
        tags: ['internal'],
        body: summarizePageBodySchema,
        response: {
          200: summarizePageResponseSchema,
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/page-summaries',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for page summary');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { url, userId, maxSentences, maxReadingMinutes } = request.body;
      const startTime = Date.now();

      request.log.info({ url, userId, maxSentences, maxReadingMinutes }, 'Processing page summary request');

      if (!isValidUrl(url)) {
        const durationMs = Date.now() - startTime;
        const result: PageSummaryResult = {
          url,
          status: 'failed',
          error: {
            code: 'INVALID_URL',
            message: 'Invalid URL format or unsupported protocol',
          },
        };
        return await reply.ok({ result, metadata: { durationMs } });
      }

      const { pageContentFetcher, llmSummarizer, userServiceClient } = getServices();

      // Step 1: Fetch page content via Crawl4AI
      const contentResult = await pageContentFetcher.fetchPageContent(url);
      if (!contentResult.ok) {
        const durationMs = Date.now() - startTime;
        const result: PageSummaryResult = {
          url,
          status: 'failed',
          error: {
            code: contentResult.error.code,
            message: contentResult.error.message,
          },
        };
        return await reply.ok({ result, metadata: { durationMs } });
      }

      // Step 2: Get user's LLM client
      const llmClientResult = await userServiceClient.getLlmClient(userId);
      if (!llmClientResult.ok) {
        const durationMs = Date.now() - startTime;
        const result: PageSummaryResult = {
          url,
          status: 'failed',
          error: {
            code: 'API_ERROR',
            message: llmClientResult.error.message,
          },
        };
        request.log.warn(
          { userId, error: llmClientResult.error.message },
          'Failed to get user LLM client'
        );
        return await reply.ok({ result, metadata: { durationMs } });
      }

      // Step 3: Summarize with user's LLM
      const summaryResult = await llmSummarizer.summarize(
        contentResult.value,
        {
          url,
          ...(maxSentences !== undefined && { maxSentences }),
          ...(maxReadingMinutes !== undefined && { maxReadingMinutes }),
        },
        llmClientResult.value
      );

      const durationMs = Date.now() - startTime;

      let result: PageSummaryResult;
      if (summaryResult.ok) {
        result = {
          url,
          status: 'success',
          summary: summaryResult.value,
        };
        request.log.info(
          {
            url,
            wordCount: summaryResult.value.wordCount,
            estimatedReadingMinutes: summaryResult.value.estimatedReadingMinutes,
            durationMs,
          },
          'Page summary completed successfully'
        );
      } else {
        result = {
          url,
          status: 'failed',
          error: {
            code: 'API_ERROR',
            message: summaryResult.error.message,
          },
        };
        request.log.warn(
          { url, error: summaryResult.error, durationMs },
          'Page summary failed'
        );
      }

      return await reply.ok({ result, metadata: { durationMs } });
    }
  );

  done();
};
