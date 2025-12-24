/**
 * Notion API utilities for notion-service.
 * Used for connection validation and page preview.
 */
import {
  ok,
  err,
  type Result,
  createNotionClient,
  mapNotionError,
  type NotionLogger,
  type NotionError,
} from '@intexuraos/common';

/**
 * Validate a Notion token.
 */
export async function validateNotionToken(
  token: string,
  logger?: NotionLogger
): Promise<Result<boolean, NotionError>> {
  try {
    const client = createNotionClient(token, logger);
    await client.users.me({});
    return ok(true);
  } catch (error) {
    const e = mapNotionError(error);
    if (e.code === 'UNAUTHORIZED') return ok(false);
    return err(e);
  }
}

/**
 * Get page with preview blocks.
 */
export async function getPageWithPreview(
  token: string,
  pageId: string,
  logger?: NotionLogger
): Promise<
  Result<
    { id: string; title: string; url: string; blocks: { type: string; content: string }[] },
    NotionError
  >
> {
  try {
    const client = createNotionClient(token, logger);

    const pageResponse = await client.pages.retrieve({ page_id: pageId });

    if (!('properties' in pageResponse)) {
      return err({ code: 'INTERNAL_ERROR', message: 'Unexpected page response format' });
    }

    const title = extractPageTitle(pageResponse.properties);
    const url = 'url' in pageResponse ? pageResponse.url : `https://notion.so/${pageId}`;

    const blocksResponse = await client.blocks.children.list({ block_id: pageId, page_size: 10 });

    const blocks: { type: string; content: string }[] = [];
    for (const block of blocksResponse.results) {
      if ('type' in block) {
        const type = block.type;
        let content = '';
        const blockData = block[type as keyof typeof block] as
          | { rich_text?: { plain_text?: string }[] }
          | undefined;
        if (blockData?.rich_text) {
          content = blockData.rich_text.map((t) => t.plain_text ?? '').join('');
        }
        blocks.push({ type, content });
      }
    }

    return ok({ id: pageResponse.id, title, url, blocks });
  } catch (error) {
    return err(mapNotionError(error));
  }
}

function extractPageTitle(properties: Record<string, unknown>): string {
  const titleProp =
    properties['title'] ?? properties['Title'] ?? properties['Name'] ?? properties['name'];

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
