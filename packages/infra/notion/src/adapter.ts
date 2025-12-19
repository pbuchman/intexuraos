/**
 * Notion API client adapter.
 * Implements NotionApiPort using @notionhq/client SDK.
 */
import { Client, isNotionClientError, APIErrorCode } from '@notionhq/client';
import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import { ok, err, type Result } from '@praxos/common';
import type {
  NotionApiPort,
  NotionPage,
  NotionBlock,
  CreatedNote,
  NotionError,
  NotionErrorCode,
  CreatePromptVaultNoteParams,
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
function extractPageTitle(page: { properties: Record<string, unknown> }): string {
  // Try common title property names
  const titleProp =
    page.properties['title'] ??
    page.properties['Title'] ??
    page.properties['Name'] ??
    page.properties['name'];

  if (
    titleProp !== null &&
    typeof titleProp === 'object' &&
    'title' in titleProp &&
    Array.isArray((titleProp as { title: unknown[] }).title)
  ) {
    const titleArray = (titleProp as { title: { plain_text?: string }[] }).title;
    return titleArray.map((t) => t.plain_text ?? '').join('');
  }

  return 'Untitled';
}

/**
 * Type guard for block objects with type property.
 */
function isBlockWithType(block: unknown): block is BlockObjectResponse {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    typeof (block as { type: unknown }).type === 'string'
  );
}

/**
 * Convert Notion block to domain block.
 */
function convertBlock(block: BlockObjectResponse): NotionBlock {
  const type = block.type;
  let content = '';

  // Extract text content based on block type
  const blockData = block[type as keyof typeof block] as
    | { rich_text?: { plain_text?: string }[] }
    | undefined;
  if (blockData !== undefined && 'rich_text' in blockData && Array.isArray(blockData.rich_text)) {
    content = blockData.rich_text.map((t) => t.plain_text ?? '').join('');
  }

  return { type, content };
}

/**
 * Notion API adapter implementing NotionApiPort.
 */
export class NotionApiAdapter implements NotionApiPort {
  async validateToken(token: string): Promise<Result<boolean, NotionError>> {
    try {
      const client = new Client({ auth: token });
      // Make a simple API call to validate the token
      await client.users.me({});
      return ok(true);
    } catch (error) {
      const notionError = mapNotionError(error);
      if (notionError.code === 'UNAUTHORIZED') {
        return ok(false);
      }
      return err(notionError);
    }
  }

  async getPageWithPreview(
    token: string,
    pageId: string
  ): Promise<Result<{ page: NotionPage; blocks: NotionBlock[] }, NotionError>> {
    try {
      const client = new Client({ auth: token });

      // Get page metadata
      const pageResponse = await client.pages.retrieve({ page_id: pageId });

      // Type guard for page with properties
      if (!('properties' in pageResponse)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Unexpected page response format',
        });
      }

      const title = extractPageTitle(pageResponse as { properties: Record<string, unknown> });
      const url = 'url' in pageResponse ? pageResponse.url : `https://notion.so/${pageId}`;

      const page: NotionPage = {
        id: pageResponse.id,
        title,
        url,
      };

      // Get first few blocks for preview
      const blocksResponse = await client.blocks.children.list({
        block_id: pageId,
        page_size: 10,
      });

      const blocks: NotionBlock[] = blocksResponse.results
        .filter(isBlockWithType)
        .map(convertBlock);

      return ok({ page, blocks });
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async createPromptVaultNote(
    params: CreatePromptVaultNoteParams
  ): Promise<Result<CreatedNote, NotionError>> {
    const { token, parentPageId, title, prompt, userId } = params;

    try {
      const client = new Client({ auth: token });

      const response = await client.pages.create({
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ text: { content: title } }],
          },
        },
        children: [
          {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ type: 'text', text: { content: 'Prompt' } }],
            },
          },
          {
            object: 'block',
            type: 'code',
            code: {
              rich_text: [{ type: 'text', text: { content: prompt } }],
              language: 'markdown',
            },
          },
          {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ type: 'text', text: { content: 'Meta' } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: 'Source: GPT PromptVault' } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: `UserId: ${userId}` } }],
            },
          },
        ],
      });

      const url = 'url' in response ? response.url : `https://notion.so/${response.id}`;

      return ok({
        id: response.id,
        url,
        title,
      });
    } catch (error) {
      return err(mapNotionError(error));
    }
  }
}
