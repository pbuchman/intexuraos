/**
 * Notion API client adapter.
 * Implements NotionApiPort using @notionhq/client SDK.
 */
import { Client, isNotionClientError, APIErrorCode, LogLevel } from '@notionhq/client';
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
 * Logger interface for Notion API calls.
 * Allows injection of custom logging (e.g., Fastify logger).
 */
export interface NotionLogger {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

/**
 * Default console logger for when no logger is provided.
 */
const defaultLogger: NotionLogger = {
  info: (msg, data) => {
    // eslint-disable-next-line no-console
    console.log(`[NotionApi] INFO: ${msg}`, data !== undefined ? JSON.stringify(data) : '');
  },
  warn: (msg, data) => {
    // eslint-disable-next-line no-console
    console.warn(`[NotionApi] WARN: ${msg}`, data !== undefined ? JSON.stringify(data) : '');
  },
  error: (msg, data) => {
    // eslint-disable-next-line no-console
    console.error(`[NotionApi] ERROR: ${msg}`, data !== undefined ? JSON.stringify(data) : '');
  },
};

/**
 * Create a logging fetch wrapper for Notion API calls.
 */
function createLoggingFetch(
  logger: NotionLogger
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const startTime = Date.now();
    const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const method = init?.method ?? 'GET';

    // Log request (redact auth header for security)
    const headersForLog: Record<string, string> = {};
    if (init?.headers !== undefined) {
      const headers =
        init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : Array.isArray(init.headers)
            ? Object.fromEntries(init.headers as [string, string][])
            : (init.headers as Record<string, string>);

      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'authorization') {
          headersForLog[key] = value.substring(0, 20) + '...[REDACTED]';
        } else {
          headersForLog[key] = value;
        }
      }
    }

    // Calculate body length safely
    let bodyLength = 0;
    if (init?.body !== undefined) {
      if (typeof init.body === 'string') {
        bodyLength = init.body.length;
      } else if (init.body instanceof ArrayBuffer) {
        bodyLength = init.body.byteLength;
      } else {
        bodyLength = -1; // Unknown body type
      }
    }

    logger.info('Notion API request', {
      method,
      url: urlString,
      headers: headersForLog,
      bodyLength,
    });

    try {
      const response = await fetch(url, init);
      const durationMs = Date.now() - startTime;

      // Clone response to read body for logging without consuming it
      const responseClone = response.clone();
      let responseBodyPreview: string;
      try {
        const responseText = await responseClone.text();
        // Truncate large responses for logging
        responseBodyPreview =
          responseText.length > 500
            ? responseText.substring(0, 500) + '...[TRUNCATED]'
            : responseText;
      } catch {
        responseBodyPreview = '[unable to read response body]';
      }

      if (response.ok) {
        logger.info('Notion API response', {
          method,
          url: urlString,
          status: response.status,
          durationMs,
          bodyPreview: responseBodyPreview,
        });
      } else {
        logger.warn('Notion API error response', {
          method,
          url: urlString,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          body: responseBodyPreview,
        });
      }

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('Notion API network error', {
        method,
        url: urlString,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

/**
 * Create a Notion client with logging enabled.
 */
function createNotionClient(token: string, logger: NotionLogger): Client {
  return new Client({
    auth: token,
    logLevel: LogLevel.DEBUG,
    fetch: createLoggingFetch(logger),
  });
}

/**
 * Map Notion API errors to domain errors.
 */
function mapNotionError(error: unknown): NotionError {
  if (isNotionClientError(error)) {
    let code: NotionErrorCode;

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
 * Accepts an optional logger for HTTP request/response logging.
 */
export class NotionApiAdapter implements NotionApiPort {
  private readonly logger: NotionLogger;

  constructor(logger?: NotionLogger) {
    this.logger = logger ?? defaultLogger;
  }

  async validateToken(token: string): Promise<Result<boolean, NotionError>> {
    try {
      const client = createNotionClient(token, this.logger);
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
      const client = createNotionClient(token, this.logger);

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
      const client = createNotionClient(token, this.logger);

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

  async listChildPages(
    token: string,
    parentPageId: string
  ): Promise<Result<NotionPage[], NotionError>> {
    try {
      const client = createNotionClient(token, this.logger);

      // List all blocks under the parent page
      const blocksResponse = await client.blocks.children.list({
        block_id: parentPageId,
        page_size: 100, // Notion max is 100
      });

      const pages: NotionPage[] = [];

      for (const block of blocksResponse.results) {
        // Check if this is a child_page block
        if ('type' in block && block.type === 'child_page') {
          const childPage = block as { id: string; child_page: { title: string } };
          pages.push({
            id: childPage.id,
            title: childPage.child_page.title,
            url: `https://notion.so/${childPage.id.replace(/-/g, '')}`,
          });
        }
      }

      return ok(pages);
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async getPromptPage(
    token: string,
    pageId: string
  ): Promise<
    Result<
      { page: NotionPage; promptContent: string; createdAt?: string; updatedAt?: string },
      NotionError
    >
  > {
    try {
      const client = createNotionClient(token, this.logger);

      // Get page metadata
      const pageResponse = await client.pages.retrieve({ page_id: pageId });

      if (!('properties' in pageResponse)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Unexpected page response format',
        });
      }

      const title = extractPageTitle(pageResponse as { properties: Record<string, unknown> });
      const url = 'url' in pageResponse ? pageResponse.url : `https://notion.so/${pageId}`;

      // Extract timestamps
      const createdAt = 'created_time' in pageResponse ? pageResponse.created_time : undefined;
      const updatedAt =
        'last_edited_time' in pageResponse ? pageResponse.last_edited_time : undefined;

      const page: NotionPage = {
        id: pageResponse.id,
        title,
        url,
      };

      // Get blocks to extract prompt content from code block
      const blocksResponse = await client.blocks.children.list({
        block_id: pageId,
        page_size: 50,
      });

      let promptContent = '';

      // Find the code block and extract its content
      for (const block of blocksResponse.results) {
        if (isBlockWithType(block) && block.type === 'code') {
          const codeBlock = block.code as { rich_text?: { plain_text?: string }[] };
          if (codeBlock.rich_text !== undefined) {
            promptContent = codeBlock.rich_text.map((t) => t.plain_text ?? '').join('');
            break; // Take the first code block
          }
        }
      }

      return ok({
        page,
        promptContent,
        ...(typeof createdAt === 'string' && { createdAt }),
        ...(typeof updatedAt === 'string' && { updatedAt }),
      });
    } catch (error) {
      return err(mapNotionError(error));
    }
  }

  async updatePromptPage(
    token: string,
    pageId: string,
    update: { title?: string; promptContent?: string }
  ): Promise<Result<{ page: NotionPage; promptContent: string; updatedAt?: string }, NotionError>> {
    try {
      const client = createNotionClient(token, this.logger);

      // Update title if provided
      if (update.title !== undefined) {
        await client.pages.update({
          page_id: pageId,
          properties: {
            title: {
              title: [{ text: { content: update.title } }],
            },
          },
        });
      }

      // Update code block content if provided
      if (update.promptContent !== undefined) {
        // Get blocks to find the code block
        const blocksResponse = await client.blocks.children.list({
          block_id: pageId,
          page_size: 50,
        });

        let codeBlockId: string | null = null;

        for (const block of blocksResponse.results) {
          if (isBlockWithType(block) && block.type === 'code') {
            codeBlockId = block.id;
            break;
          }
        }

        if (codeBlockId !== null) {
          // Update existing code block
          await client.blocks.update({
            block_id: codeBlockId,
            code: {
              rich_text: [{ type: 'text', text: { content: update.promptContent } }],
              language: 'markdown',
            },
          });
        }
      }

      // Fetch updated page data
      const pageResponse = await client.pages.retrieve({ page_id: pageId });

      if (!('properties' in pageResponse)) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Unexpected page response format',
        });
      }

      const title = extractPageTitle(pageResponse as { properties: Record<string, unknown> });
      const url = 'url' in pageResponse ? pageResponse.url : `https://notion.so/${pageId}`;
      const updatedAt =
        'last_edited_time' in pageResponse ? pageResponse.last_edited_time : undefined;

      // Get current prompt content
      const blocksResponse = await client.blocks.children.list({
        block_id: pageId,
        page_size: 50,
      });

      let promptContent = '';
      for (const block of blocksResponse.results) {
        if (isBlockWithType(block) && block.type === 'code') {
          const codeBlock = block.code as { rich_text?: { plain_text?: string }[] };
          if (codeBlock.rich_text !== undefined) {
            promptContent = codeBlock.rich_text.map((t) => t.plain_text ?? '').join('');
            break;
          }
        }
      }

      return ok({
        page: { id: pageResponse.id, title, url },
        promptContent,
        ...(typeof updatedAt === 'string' && { updatedAt }),
      });
    } catch (error) {
      return err(mapNotionError(error));
    }
  }
}
