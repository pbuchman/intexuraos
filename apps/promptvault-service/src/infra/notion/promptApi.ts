/**
 * Notion API for PromptVault operations.
 * Simplified: direct functions, no abstraction layers.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import {
  createNotionClient,
  extractPageTitle,
  mapNotionError,
  type NotionError,
  type NotionLogger,
} from '@intexuraos/infra-notion';
import type { NotionServiceClient } from './notionServiceClient.js';
import type { PromptVaultSettingsPort } from '../../domain/promptvault/ports/index.js';

// ============================================================================
// Types
// ============================================================================

export interface Prompt {
  id: string;
  title: string;
  content: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PromptVaultError {
  code: 'NOT_FOUND' | 'NOT_CONNECTED' | 'UNAUTHORIZED' | 'DOWNSTREAM_ERROR' | 'INTERNAL_ERROR';
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

  return chunks.length > 0 ? chunks : [''];
}

function joinTextChunks(chunks: string[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0] ?? '';
  return chunks
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .join('\n');
}

// ============================================================================
// Helper to get user context
// ============================================================================

async function getUserContext(
  userId: string,
  notionServiceClient: NotionServiceClient,
  promptVaultSettings: PromptVaultSettingsPort
): Promise<Result<{ token: string; promptVaultPageId: string }, PromptVaultError>> {
  // Fetch token from notion-service and promptVaultPageId from local Firestore in parallel
  const [tokenContextResult, pageIdResult] = await Promise.all([
    notionServiceClient.getNotionToken(userId),
    promptVaultSettings.getPromptVaultPageId(userId),
  ]);

  // Check token context
  if (!tokenContextResult.ok) {
    const errorCode =
      tokenContextResult.error.code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'DOWNSTREAM_ERROR';
    return err({ code: errorCode, message: tokenContextResult.error.message });
  }

  const { connected, token } = tokenContextResult.value;
  if (!connected || token === null) {
    return err({ code: 'NOT_CONNECTED', message: 'Notion integration is not configured' });
  }

  // Check promptVaultPageId
  if (!pageIdResult.ok) {
    return err({ code: 'DOWNSTREAM_ERROR', message: pageIdResult.error.message });
  }

  const promptVaultPageId = pageIdResult.value;
  if (promptVaultPageId === null) {
    return err({ code: 'NOT_CONNECTED', message: 'PromptVault page ID not configured' });
  }

  return ok({ token, promptVaultPageId });
}

function mapError(e: NotionError): PromptVaultError {
  switch (e.code) {
    case 'NOT_FOUND':
      return { code: 'NOT_FOUND', message: e.message };
    case 'UNAUTHORIZED':
      return { code: 'UNAUTHORIZED', message: e.message };
    default:
      return { code: 'DOWNSTREAM_ERROR', message: e.message };
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Create a new prompt in user's PromptVault.
 */
export async function createPrompt(
  userId: string,
  title: string,
  content: string,
  notionServiceClient: NotionServiceClient,
  promptVaultSettings: PromptVaultSettingsPort,
  logger?: NotionLogger
): Promise<Result<Prompt, PromptVaultError>> {
  const ctx = await getUserContext(userId, notionServiceClient, promptVaultSettings);
  if (!ctx.ok) return err(ctx.error);

  const { token, promptVaultPageId } = ctx.value;

  try {
    const client = createNotionClient(token, logger);
    const chunks = splitTextIntoChunks(content);

    const codeBlocks = chunks.map((chunk) => ({
      object: 'block' as const,
      type: 'code' as const,
      code: {
        rich_text: [{ type: 'text' as const, text: { content: chunk } }],
        language: 'markdown' as const,
      },
    }));

    const response = await client.pages.create({
      parent: { page_id: promptVaultPageId },
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
      children: [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: 'Prompt' } }] },
        },
        ...codeBlocks,
        {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: 'Meta' } }] },
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
    const now = new Date().toISOString();

    return ok({ id: response.id, title, content, url, createdAt: now, updatedAt: now });
  } catch (error) {
    return err(mapError(mapNotionError(error)));
  }
}

/**
 * List all prompts in user's PromptVault.
 */
export async function listPrompts(
  userId: string,
  notionServiceClient: NotionServiceClient,
  promptVaultSettings: PromptVaultSettingsPort,
  logger?: NotionLogger
): Promise<Result<Prompt[], PromptVaultError>> {
  const ctx = await getUserContext(userId, notionServiceClient, promptVaultSettings);
  if (!ctx.ok) return err(ctx.error);

  const { token, promptVaultPageId } = ctx.value;

  try {
    const client = createNotionClient(token, logger);

    // List child pages
    const blocksResponse = await client.blocks.children.list({
      block_id: promptVaultPageId,
      page_size: 100,
    });

    const prompts: Prompt[] = [];

    for (const block of blocksResponse.results) {
      if ('type' in block && block.type === 'child_page') {
        const childPage = block as { id: string; child_page: { title: string } };

        // Get page details
        const pageResult = await getPromptById(token, childPage.id, logger);
        if (pageResult.ok) {
          prompts.push(pageResult.value);
        }
      }
    }

    return ok(prompts);
  } catch (error) {
    return err(mapError(mapNotionError(error)));
  }
}

/**
 * Get a prompt by ID.
 */
export async function getPrompt(
  userId: string,
  promptId: string,
  notionServiceClient: NotionServiceClient,
  promptVaultSettings: PromptVaultSettingsPort,
  logger?: NotionLogger
): Promise<Result<Prompt, PromptVaultError>> {
  const ctx = await getUserContext(userId, notionServiceClient, promptVaultSettings);
  if (!ctx.ok) return err(ctx.error);

  return await getPromptById(ctx.value.token, promptId, logger);
}

async function getPromptById(
  token: string,
  pageId: string,
  logger?: NotionLogger
): Promise<Result<Prompt, PromptVaultError>> {
  try {
    const client = createNotionClient(token, logger);

    const pageResponse = await client.pages.retrieve({ page_id: pageId });

    if (!('properties' in pageResponse)) {
      return err({ code: 'INTERNAL_ERROR', message: 'Unexpected page response format' });
    }

    const title = extractPageTitle(pageResponse.properties);
    const url = 'url' in pageResponse ? pageResponse.url : `https://notion.so/${pageId}`;
    const createdAt = 'created_time' in pageResponse ? pageResponse.created_time : undefined;
    const updatedAt =
      'last_edited_time' in pageResponse ? pageResponse.last_edited_time : undefined;

    // Get blocks for content
    const blocksResponse = await client.blocks.children.list({ block_id: pageId, page_size: 50 });

    const codeBlocks: string[] = [];
    for (const block of blocksResponse.results) {
      if ('type' in block && block.type === 'code') {
        const codeBlock = block as unknown as {
          code: { rich_text?: { plain_text?: string }[] };
        };
        if (codeBlock.code.rich_text) {
          const content = codeBlock.code.rich_text.map((t) => t.plain_text ?? '').join('');
          if (content.length > 0) codeBlocks.push(content);
        }
      }
    }

    const content = joinTextChunks(codeBlocks);

    return ok({
      id: pageId,
      title,
      content,
      url,
      ...(createdAt !== undefined && createdAt !== '' ? { createdAt } : {}),
      ...(updatedAt !== undefined && updatedAt !== '' ? { updatedAt } : {}),
    });
  } catch (error) {
    return err(mapError(mapNotionError(error)));
  }
}

/**
 * Update a prompt.
 */
export async function updatePrompt(
  userId: string,
  promptId: string,
  update: { title?: string; content?: string },
  notionServiceClient: NotionServiceClient,
  promptVaultSettings: PromptVaultSettingsPort,
  logger?: NotionLogger
): Promise<Result<Prompt, PromptVaultError>> {
  const ctx = await getUserContext(userId, notionServiceClient, promptVaultSettings);
  if (!ctx.ok) return err(ctx.error);

  const { token } = ctx.value;

  try {
    const client = createNotionClient(token, logger);

    // Update title if provided
    if (update.title !== undefined) {
      await client.pages.update({
        page_id: promptId,
        properties: { title: { title: [{ text: { content: update.title } }] } },
      });
    }

    // Update content if provided
    if (update.content !== undefined) {
      const blocksResponse = await client.blocks.children.list({
        block_id: promptId,
        page_size: 50,
      });

      const codeBlockIds: string[] = [];
      for (const block of blocksResponse.results) {
        if ('type' in block && block.type === 'code') {
          codeBlockIds.push(block.id);
        }
      }

      const newChunks = splitTextIntoChunks(update.content);

      // Update or delete existing blocks
      for (let i = 0; i < codeBlockIds.length; i++) {
        const blockId = codeBlockIds[i];
        if (blockId === undefined) continue;

        if (i >= newChunks.length) {
          await client.blocks.delete({ block_id: blockId });
        } else {
          await client.blocks.update({
            block_id: blockId,
            code: {
              rich_text: [{ type: 'text', text: { content: newChunks[i] ?? '' } }],
              language: 'markdown',
            },
          });
        }
      }

      // Append new blocks if needed
      for (let i = codeBlockIds.length; i < newChunks.length; i++) {
        await client.blocks.children.append({
          block_id: promptId,
          children: [
            {
              object: 'block',
              type: 'code',
              code: {
                rich_text: [{ type: 'text', text: { content: newChunks[i] ?? '' } }],
                language: 'markdown',
              },
            },
          ],
        });
      }
    }

    // Return updated prompt
    return await getPromptById(token, promptId, logger);
  } catch (error) {
    return err(mapError(mapNotionError(error)));
  }
}
