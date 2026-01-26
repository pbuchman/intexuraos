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
// Text chunking (Notion has 2000 char limit per block)
// ============================================================================

const MAX_CHUNK_SIZE = 1950;

function splitTextIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }

    // Find best split point
    let splitPoint = remaining.lastIndexOf('\n\n', MAX_CHUNK_SIZE);
    if (splitPoint < MAX_CHUNK_SIZE * 0.5) splitPoint = remaining.lastIndexOf('\n', MAX_CHUNK_SIZE);
    if (splitPoint < MAX_CHUNK_SIZE * 0.5) splitPoint = remaining.lastIndexOf('. ', MAX_CHUNK_SIZE);
    if (splitPoint < MAX_CHUNK_SIZE * 0.3) splitPoint = remaining.lastIndexOf(' ', MAX_CHUNK_SIZE);
    if (splitPoint < MAX_CHUNK_SIZE * 0.2) splitPoint = MAX_CHUNK_SIZE;

    chunks.push(remaining.substring(0, splitPoint).trimEnd());
    remaining = remaining.substring(splitPoint).trimStart();
  }

  /* v8 ignore start - Defensive: loop always adds at least one chunk */
  if (chunks.length === 0) return [''];
  /* v8 ignore stop */
  return chunks;
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const client: NotionClient = createNotionClient(notionToken, logger) as NotionClient;

    // Filter completed LLM results
    const completedResults = research.llmResults.filter((r) => r.status === 'completed');

    // Create main research page
    const synthesisChunks = splitTextIntoChunks(stripHiddenContent(research.synthesizedResult));
    const synthesisCodeBlocks = synthesisChunks.map((chunk) => ({
      object: 'block' as const,
      type: 'code' as const,
      code: {
        rich_text: [{ type: 'text' as const, text: { content: chunk } }],
        language: 'markdown' as const,
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const mainPageResponse = await client.pages.create({
      parent: { page_id: targetPageId },
      properties: {
        title: { title: [{ text: { content: research.title || 'Research' } }] },
      },
      children: [
        {
          object: 'block' as const,
          type: 'heading_2' as const,
          heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'Synthesis' } }] },
        },
        ...synthesisCodeBlocks,
        {
          object: 'block' as const,
          type: 'heading_2' as const,
          heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'Sources' } }] },
        },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const mainPageId = mainPageResponse.id;
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions */
    const mainPageUrl =
      'url' in mainPageResponse && typeof mainPageResponse.url === 'string'
        ? mainPageResponse.url
        : `https://notion.so/${mainPageId}`;
    /* eslint-enable */

    const llmReportPages: { model: string; pageId: string; pageUrl: string }[] = [];

    // Create child pages for each completed LLM result
    for (const llmResult of completedResults) {
      const childBlocks: (
        | {
            object: 'block';
            type: 'heading_2';
            heading_2: { rich_text: { type: 'text'; text: { content: string } }[] };
          }
        | {
            object: 'block';
            type: 'code';
            code: {
              rich_text: { type: 'text'; text: { content: string } }[];
              language: 'markdown';
            };
          }
        | {
            object: 'block';
            type: 'bulleted_list_item';
            bulleted_list_item: {
              rich_text: (
                | { type: 'text'; text: { content: string } }
                | { type: 'text'; text: { content: string; link: { url: string } } }
              )[];
            };
          }
      )[] = [
        {
          object: 'block' as const,
          type: 'heading_2' as const,
          heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'Response' } }] },
        },
      ];

      if (llmResult.result !== undefined && llmResult.result !== '') {
        const resultChunks = splitTextIntoChunks(stripHiddenContent(llmResult.result));
        for (const chunk of resultChunks) {
          childBlocks.push({
            object: 'block' as const,
            type: 'code' as const,
            code: {
              rich_text: [{ type: 'text' as const, text: { content: chunk } }],
              language: 'markdown' as const,
            },
          });
        }
      }

      // Add sources section if available
      if (llmResult.sources !== undefined && llmResult.sources.length > 0) {
        childBlocks.push({
          object: 'block' as const,
          type: 'heading_2' as const,
          heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'Sources' } }] },
        });
        for (const source of llmResult.sources) {
          childBlocks.push({
            object: 'block' as const,
            type: 'bulleted_list_item' as const,
            bulleted_list_item: {
              rich_text: [
                { type: 'text' as const, text: { content: 'Source: ' } },
                { type: 'text' as const, text: { content: source, link: { url: source } } },
              ],
            },
          });
        }
      }

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      const pageResponse = await client.pages.create({
        parent: { page_id: mainPageId },
        properties: {
          title: { title: [{ text: { content: `[${llmResult.model}] Report` } }] },
        },
        children: childBlocks,
      });

      const pageId = pageResponse.id;
      /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions */
      const pageUrl =
        'url' in pageResponse && typeof pageResponse.url === 'string'
          ? pageResponse.url
          : `https://notion.so/${pageId}`;
      /* eslint-enable */
      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      llmReportPages.push({
        model: llmResult.model,
        pageId,
        pageUrl,
      });
      /* eslint-enable */
    }

    // Append source links to main page
    if (llmReportPages.length > 0) {
      const sourceLinks = llmReportPages.map((page) => ({
        object: 'block' as const,
        type: 'bulleted_list_item' as const,
        bulleted_list_item: {
          rich_text: [
            { type: 'text' as const, text: { content: `[${page.model}] Report: ` } },
            { type: 'text' as const, text: { content: page.pageUrl, link: { url: page.pageUrl } } },
          ],
        },
      }));

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      await client.blocks.children.append({
        block_id: mainPageId,
        children: sourceLinks,
      });
      /* eslint-enable */
    }

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    return ok({
      mainPageId,
      mainPageUrl,
      llmReportPages,
    });
    /* eslint-enable */
  } catch (error) {
    /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
    return err(mapExportError(mapNotionError(error)));
    /* eslint-enable */
  }
}
