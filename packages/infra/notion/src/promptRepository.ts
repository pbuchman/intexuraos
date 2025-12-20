/**
 * Notion-based PromptRepository implementation.
 * 
 * Maps Prompt domain model to/from Notion pages and blocks.
 * Implements the deterministic block structure as specified.
 */

import { Client, isNotionClientError, APIErrorCode } from '@notionhq/client';
import type {
  BlockObjectResponse,
  PageObjectResponse,
} from '@notionhq/client/build/src/api-endpoints.js';
import { ok, err, type Result } from '@praxos/common';
import type {
  PromptRepository,
  Prompt,
  PromptCreate,
  PromptUpdate,
  PromptListOptions,
  PromptListResult,
  PromptSummary,
  PromptSource,
  NotionError,
  NotionErrorCode,
  NotionConnectionRepository,
} from '@praxos/domain-promptvault';

/**
 * Map Notion API errors to domain errors.
 */
function mapNotionError(error: unknown): NotionError {
  if (isNotionClientError(error)) {
    let code: NotionErrorCode = 'INTERNAL_ERROR';

    switch (error.code) {
      case APIErrorCode.Unauthorized:
        code = 'UNAUTHORIZED';
        break;
      case APIErrorCode.ObjectNotFound:
        code = 'NOT_FOUND';
        break;
      case APIErrorCode.RateLimited:
        code = 'RATE_LIMITED';
        break;
      case APIErrorCode.ValidationError:
      case APIErrorCode.InvalidJSON:
        code = 'VALIDATION_ERROR';
        break;
      default:
        code = 'INTERNAL_ERROR';
    }

    return {
      code,
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : 'Unknown Notion API error';
  return {
    code: 'INTERNAL_ERROR',
    message,
  };
}

/**
 * Extract title from Notion page properties.
 */
function extractPageTitle(page: PageObjectResponse): string {
  const titleProp =
    page.properties['title'] ??
    page.properties['Title'] ??
    page.properties['Name'] ??
    page.properties['name'];

  if (typeof titleProp === 'object' && 'title' in titleProp) {
    const titleArray = (titleProp as { title: { plain_text?: string }[] }).title;
    if (Array.isArray(titleArray)) {
      return titleArray.map((t) => t.plain_text ?? '').join('');
    }
  }

  return 'Untitled';
}

/**
 * Extract timestamps from Notion page.
 */
function extractTimestamps(page: PageObjectResponse): {
  createdAt: string;
  updatedAt: string;
} {
  return {
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
  };
}

/**
 * Deterministic block structure parser.
 * 
 * Expected structure:
 * 1. Heading 1: "Prompt"
 * 2. Code block (plain text): prompt content
 * 3. Divider
 * 4. Heading 2: "Metadata"
 * 5. Bulleted list items:
 *    - Tags: tag1, tag2, tag3
 *    - Source: gpt / manual / import
 *    - Created by: <userId>
 */
interface ParsedBlocks {
  content: string;
  tags: string[] | undefined;
  source: PromptSource | undefined;
}

function parsePromptBlocks(blocks: BlockObjectResponse[]): ParsedBlocks {
  let content = '';
  let tags: string[] | undefined = undefined;
  let source: PromptSource | undefined = undefined;

  for (const block of blocks) {
    if (block.type === 'code' && 'code' in block) {
      // Extract prompt content from code block
      const richText = block.code.rich_text;
      content = richText
        .map((t) => ('plain_text' in t && typeof t.plain_text === 'string' ? t.plain_text : ''))
        .join('');
    } else if (block.type === 'bulleted_list_item' && 'bulleted_list_item' in block) {
      // Extract metadata from bulleted list items
      const richText = block.bulleted_list_item.rich_text;
      const text = richText
        .map((t) => ('plain_text' in t && typeof t.plain_text === 'string' ? t.plain_text : ''))
        .join('');

      if (text.startsWith('Tags:')) {
        const tagsPart = text.substring(5).trim();
        if (tagsPart.length > 0) {
          tags = tagsPart.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        }
      } else if (text.startsWith('Source:')) {
        const sourcePart = text.substring(7).trim();
        const match = /^(gpt|manual|import)(\s+\((.+)\))?/i.exec(sourcePart);
        if (match?.[1] !== undefined) {
          const type = match[1].toLowerCase() as 'gpt' | 'manual' | 'import';
          const details = match[3];
          source = details !== undefined ? { type, details } : { type, details: undefined };
        }
      }
    }
  }

  return { content, tags, source };
}

/**
 * Generate preview from content (first 200 characters).
 */
function generatePreview(content: string): string {
  return content.length > 200 ? content.substring(0, 197) + '...' : content;
}

/**
 * Build deterministic block structure for Notion page.
 */
function buildPromptBlocks(
  prompt: string,
  tags: readonly string[] | undefined,
  source: PromptSource | undefined,
  userId: string | undefined
): unknown[] {
  const blocks: unknown[] = [
    // 1. Heading 1: "Prompt"
    {
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{ type: 'text', text: { content: 'Prompt' } }],
      },
    },
    // 2. Code block (plain text): prompt content
    {
      object: 'block',
      type: 'code',
      code: {
        rich_text: [{ type: 'text', text: { content: prompt } }],
        language: 'plain text',
      },
    },
    // 3. Divider
    {
      object: 'block',
      type: 'divider',
      divider: {},
    },
    // 4. Heading 2: "Metadata"
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Metadata' } }],
      },
    },
  ];

  // 5. Bulleted list items for metadata
  if (tags !== undefined && tags.length > 0) {
    blocks.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: `Tags: ${tags.join(', ')}` } }],
      },
    });
  }

  if (source !== undefined) {
    const sourceText =
      source.details !== undefined
        ? `Source: ${source.type} (${source.details})`
        : `Source: ${source.type}`;
    blocks.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: sourceText } }],
      },
    });
  }

  if (userId !== undefined) {
    blocks.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: `Created by: ${userId}` } }],
      },
    });
  }

  return blocks;
}

/**
 * Notion-based PromptRepository implementation.
 */
export class NotionPromptRepository implements PromptRepository {
  constructor(private readonly connectionRepository: NotionConnectionRepository) {}

  async createPrompt(userId: string, data: PromptCreate): Promise<Result<Prompt, NotionError>> {
    try {
      // Get token and parent page ID
      const tokenResult = await this.connectionRepository.getToken(userId);
      if (!tokenResult.ok) {
        return err(tokenResult.error);
      }
      const token = tokenResult.value;
      if (token === null) {
        return err({
          code: 'UNAUTHORIZED',
          message: 'Notion token not found',
        });
      }

      const configResult = await this.connectionRepository.getConnection(userId);
      if (!configResult.ok) {
        return err(configResult.error);
      }
      const config = configResult.value;
      if (config === null) {
        return err({
          code: 'NOT_FOUND',
          message: 'Notion configuration not found',
        });
      }

      const parentPageId = config.promptVaultPageId;
      const client = new Client({ auth: token });

      // Create page with deterministic block structure
      const blocks = buildPromptBlocks(data.prompt, data.tags, data.source, userId);

      const response = await client.pages.create({
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ text: { content: data.title } }],
          },
        },
        children: blocks as never,
      });

      // Type guard
      if (!('properties' in response)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Unexpected response format from Notion API',
        });
      }

      const page = response;
      const { createdAt, updatedAt } = extractTimestamps(page);
      const url = page.url;

      return ok({
        id: page.id,
        title: data.title,
        content: data.prompt,
        preview: generatePreview(data.prompt),
        tags: data.tags !== undefined ? [...data.tags] : undefined,
        source: data.source ?? undefined,
        createdAt,
        updatedAt,
        url,
      });
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async listPrompts(
    userId: string,
    options?: PromptListOptions
  ): Promise<Result<PromptListResult, NotionError>> {
    try {
      // Get token and parent page ID
      const tokenResult = await this.connectionRepository.getToken(userId);
      if (!tokenResult.ok) {
        return err(tokenResult.error);
      }
      const token = tokenResult.value;
      if (token === null) {
        return err({
          code: 'UNAUTHORIZED',
          message: 'Notion token not found',
        });
      }

      const configResult = await this.connectionRepository.getConnection(userId);
      if (!configResult.ok) {
        return err(configResult.error);
      }
      const config = configResult.value;
      if (config === null) {
        return err({
          code: 'NOT_FOUND',
          message: 'Notion configuration not found',
        });
      }

      const parentPageId = config.promptVaultPageId;
      const client = new Client({ auth: token });

      const limit = options?.limit ?? 50;
      const cursor = options?.cursor;
      const includeContent = options?.includeContent ?? false;

      // Query child pages
      const queryParams: {
        block_id: string;
        page_size: number;
        start_cursor?: string;
      } = {
        block_id: parentPageId,
        page_size: limit,
      };
      if (cursor !== undefined) {
        queryParams.start_cursor = cursor;
      }

      const response = await client.blocks.children.list(queryParams);

      // Filter for pages only
      const pages: PageObjectResponse[] = [];
      for (const block of response.results) {
        if ('type' in block && 'id' in block) {
          // We need to fetch the actual page to get it as PageObjectResponse
          try {
            const page = await client.pages.retrieve({ page_id: (block as { id: string }).id });
            if ('properties' in page) {
              pages.push(page);
            }
          } catch {
            continue;
          }
        }
      }

      // Fetch page details
      const prompts: (Prompt | PromptSummary)[] = [];
      for (const pageObj of pages) {
        try {
          const title = extractPageTitle(pageObj);
          const { createdAt, updatedAt } = extractTimestamps(pageObj);
          const url = pageObj.url;

          if (includeContent) {
            // Fetch blocks to get content
            const blocksResponse = await client.blocks.children.list({
              block_id: pageObj.id,
            });
            const blocks = blocksResponse.results.filter(
              (b): b is BlockObjectResponse => 'type' in b
            );
            const { content, tags, source } = parsePromptBlocks(blocks);

            prompts.push({
              id: pageObj.id,
              title,
              content,
              preview: generatePreview(content),
              tags: tags ?? undefined,
              source: source ?? undefined,
              createdAt,
              updatedAt,
              url,
            });
          } else {
            // Just return summary (without fetching blocks)
            // For summary, we can't get content/tags/source without fetching blocks
            // So we return minimal info
            prompts.push({
              id: pageObj.id,
              title,
              preview: '',
              tags: undefined,
              source: undefined,
              createdAt,
              updatedAt,
              url,
            });
          }
        } catch {
          // Skip pages that fail to load
          continue;
        }
      }

      return ok({
        prompts,
        hasMore: response.has_more,
        nextCursor: response.next_cursor ?? undefined,
      });
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async getPrompt(userId: string, promptId: string): Promise<Result<Prompt, NotionError>> {
    try {
      // Get token
      const tokenResult = await this.connectionRepository.getToken(userId);
      if (!tokenResult.ok) {
        return err(tokenResult.error);
      }
      const token = tokenResult.value;
      if (token === null) {
        return err({
          code: 'UNAUTHORIZED',
          message: 'Notion token not found',
        });
      }

      const client = new Client({ auth: token });

      // Fetch page
      const page = await client.pages.retrieve({ page_id: promptId });
      if (!('properties' in page)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Unexpected response format from Notion API',
        });
      }

      const pageObj = page;
      const title = extractPageTitle(pageObj);
      const { createdAt, updatedAt } = extractTimestamps(pageObj);
      const url = pageObj.url;

      // Fetch blocks
      const blocksResponse = await client.blocks.children.list({
        block_id: promptId,
      });
      const blocks = blocksResponse.results.filter((b): b is BlockObjectResponse => 'type' in b);
      const { content, tags, source } = parsePromptBlocks(blocks);

      return ok({
        id: pageObj.id,
        title,
        content,
        preview: generatePreview(content),
        tags: tags ?? undefined,
        source: source ?? undefined,
        createdAt,
        updatedAt,
        url,
      });
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async updatePrompt(
    userId: string,
    promptId: string,
    data: PromptUpdate
  ): Promise<Result<Prompt, NotionError>> {
    try {
      // Get token
      const tokenResult = await this.connectionRepository.getToken(userId);
      if (!tokenResult.ok) {
        return err(tokenResult.error);
      }
      const token = tokenResult.value;
      if (token === null) {
        return err({
          code: 'UNAUTHORIZED',
          message: 'Notion token not found',
        });
      }

      const client = new Client({ auth: token });

      // Fetch existing prompt
      const existingResult = await this.getPrompt(userId, promptId);
      if (!existingResult.ok) {
        return err(existingResult.error);
      }
      const existing = existingResult.value;

      // Merge updates
      const updatedTitle = data.title ?? existing.title;
      const updatedContent = data.prompt ?? existing.content;
      const updatedTags = data.tags ?? existing.tags;
      const updatedSource = data.source ?? existing.source;

      // Update title if changed
      if (data.title !== undefined) {
        await client.pages.update({
          page_id: promptId,
          properties: {
            title: {
              title: [{ text: { content: updatedTitle } }],
            },
          },
        });
      }

      // Update blocks if content/tags/source changed
      if (data.prompt !== undefined || data.tags !== undefined || data.source !== undefined) {
        // Delete existing blocks
        const blocksResponse = await client.blocks.children.list({
          block_id: promptId,
        });
        for (const block of blocksResponse.results) {
          if ('id' in block) {
            await client.blocks.delete({ block_id: block.id });
          }
        }

        // Append new blocks with deterministic structure
        const blocks = buildPromptBlocks(updatedContent, updatedTags, updatedSource, userId);
        await client.blocks.children.append({
          block_id: promptId,
          children: blocks as never,
        });
      }

      // Fetch updated prompt
      return await this.getPrompt(userId, promptId);
    } catch (error) {
      return err(mapNotionError(error));
    }
  }
}
