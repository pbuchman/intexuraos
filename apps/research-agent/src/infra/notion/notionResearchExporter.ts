/**
 * Notion Research Exporter
 *
 * Exports completed research to Notion as a hierarchical page structure.
 * Uses @intexuraos/infra-notion package for Notion client creation and error handling.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import {
  createNotionClient,
  mapNotionError,
  type NotionClient,
  type NotionLogger,
} from '@intexuraos/infra-notion';
import type { Research } from '../../domain/research/models/Research.js';
import { markdownToNotionBlocks } from './markdownToNotionBlocks.js';

// ============================================================================
// Types
// ============================================================================

export interface NotionResearchExportResult {
  mainPageId: string;
  mainPageUrl: string;
  llmReportPages: { model: string; pageId: string; pageUrl: string }[];
}

export interface NotionResearchExportError {
  code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
  message: string;
}

// ============================================================================
// Content filtering
// ============================================================================

/**
 * Removes content inside <details> HTML tags (hidden content).
 * Uses non-greedy regex to handle multiple details sections.
 * Note: Does not correctly handle nested <details> tags.
 */
function stripHiddenContent(content: string): string {
  return content.replace(/<details[\s\S]*?<\/details>/gi, '');
}

// ============================================================================
// Error mapping
// ============================================================================

// Define error type locally to avoid import resolution issues
type LocalNotionErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

interface LocalNotionError {
  code: LocalNotionErrorCode;
  message: string;
}

function mapExportError(e: LocalNotionError): NotionResearchExportError {
  const code = e.code;
  const message = e.message;

  switch (code) {
    case 'NOT_FOUND':
      return { code: 'NOT_FOUND', message };
    case 'UNAUTHORIZED':
      return { code: 'UNAUTHORIZED', message };
    case 'RATE_LIMITED':
      return { code: 'RATE_LIMITED', message };
    default:
      return { code: 'INTERNAL_ERROR', message };
  }
}

// ============================================================================
// Main export function
// ============================================================================

/**
 * Exports a completed research to Notion as a hierarchical page structure.
 *
 * Structure:
 * - Main Research Page (child of targetPageId)
 *   - Image: cover image (if shareInfo.coverImageId exists)
 *   - Heading: "Synthesis"
 *   - Content: research.synthesizedResult (chunked into code blocks)
 *   - Heading: "Sources"
 *   - Bulleted list with links to LLM report subpages
 * - LLM Report Pages (children of main page)
 *   - Title: "[Model] Report"
 *   - Heading: "Response"
 *   - Content: llmResult.result (chunked)
 *   - Heading: "Sources" (if llmResult.sources exists)
 *   - Bulleted list of source URLs
 */
export async function exportResearchToNotion(
  research: Research,
  notionToken: string,
  targetPageId: string,
  logger: NotionLogger
): Promise<Result<NotionResearchExportResult, NotionResearchExportError>> {
  if (research.synthesizedResult === undefined || research.synthesizedResult === '') {
    return err({ code: 'INTERNAL_ERROR', message: 'Research synthesis not completed' });
  }

  try {
     
    const client: NotionClient = createNotionClient(notionToken, logger);

    // Filter completed LLM results
    const completedResults = research.llmResults.filter((r) => r.status === 'completed');

    // Build cover image block if cover image URL exists
    const coverImageUrl = research.shareInfo?.coverImageUrl;
    const trimmedCoverImageUrl = coverImageUrl?.trim();
    const hasCoverImage = trimmedCoverImageUrl !== undefined && trimmedCoverImageUrl !== '';

    const coverImageBlock = hasCoverImage
      ? [
          {
            object: 'block' as const,
            type: 'image' as const,
            image: {
              type: 'external' as const,
              external: { url: trimmedCoverImageUrl },
            },
          },
        ]
      : [];

    if (hasCoverImage) {
      logger.info(
        'Including cover image in Notion export',
        { coverImageUrl: trimmedCoverImageUrl }
      );
    }

    // Create main research page - convert markdown to Notion blocks
    const synthesisBlocks = markdownToNotionBlocks(stripHiddenContent(research.synthesizedResult));

    // Notion SDK types are strict but our blocks are compatible
    const mainPageChildren = [
      ...coverImageBlock,
      {
        object: 'block' as const,
        type: 'heading_2' as const,
        heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'Synthesis' } }] },
      },
      ...synthesisBlocks,
      {
        object: 'block' as const,
        type: 'heading_2' as const,
        heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'Sources' } }] },
      },
    ];

    const mainPageResponse = await client.pages.create({
      parent: { page_id: targetPageId },
      properties: {
        title: { title: [{ text: { content: research.title || 'Research' } }] },
      },
      // Our block types are compatible with Notion SDK's BlockObjectRequest
      children: mainPageChildren as NonNullable<Parameters<typeof client.pages.create>[0]['children']>,
    });

     
    const mainPageId = mainPageResponse.id;
     
    const mainPageUrl =
      'url' in mainPageResponse && typeof mainPageResponse.url === 'string'
        ? mainPageResponse.url
        : `https://notion.so/${mainPageId}`;
     

    const llmReportPages: { model: string; pageId: string; pageUrl: string }[] = [];

    // Create child pages for each completed LLM result
    for (const llmResult of completedResults) {
      // Convert LLM result markdown to Notion blocks
      const resultBlocks =
        llmResult.result !== undefined && llmResult.result !== ''
          ? markdownToNotionBlocks(stripHiddenContent(llmResult.result))
          : [];

      // Build source list items if available
      const sourceBlocks =
        llmResult.sources !== undefined && llmResult.sources.length > 0
          ? [
              {
                object: 'block' as const,
                type: 'heading_2' as const,
                heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'Sources' } }] },
              },
              ...llmResult.sources.map((source) => ({
                object: 'block' as const,
                type: 'bulleted_list_item' as const,
                bulleted_list_item: {
                  rich_text: [
                    { type: 'text' as const, text: { content: 'Source: ' } },
                    { type: 'text' as const, text: { content: source, link: { url: source } } },
                  ],
                },
              })),
            ]
          : [];

      const childBlocks = [
        {
          object: 'block' as const,
          type: 'heading_2' as const,
          heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'Response' } }] },
        },
        ...resultBlocks,
        ...sourceBlocks,
      ];

      const pageResponse = await client.pages.create({
        parent: { page_id: mainPageId },
        properties: {
          title: { title: [{ text: { content: `[${llmResult.model}] Report` } }] },
        },
        // Our block types are compatible with Notion SDK's BlockObjectRequest
        children: childBlocks as NonNullable<Parameters<typeof client.pages.create>[0]['children']>,
      });

      const pageId = pageResponse.id;
       
      const pageUrl =
        'url' in pageResponse && typeof pageResponse.url === 'string'
          ? pageResponse.url
          : `https://notion.so/${pageId}`;
       
       
      llmReportPages.push({
        model: llmResult.model,
        pageId,
        pageUrl,
      });
       
    }

    // Child pages appear automatically as document references in Notion
    // No need to append duplicate bulleted links

    return ok({
      mainPageId,
      mainPageUrl,
      llmReportPages,
    });
     
  } catch (error) {
     
    return err(mapExportError(mapNotionError(error)));
     
  }
}
