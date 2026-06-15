import type { Result } from '@intexuraos/common-core';
import type { LinkPreviewFetcherPort } from '../../domain/whatsapp/ports/linkPreviewFetcher.js';
import type { LinkPreview, LinkPreviewError } from '../../domain/whatsapp/models/LinkPreview.js';
import type { Logger } from 'pino';
import { createWebAgentServiceClient } from '@intexuraos/internal-clients';

export interface WebAgentLinkPreviewClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

export function createWebAgentLinkPreviewClient(
  config: WebAgentLinkPreviewClientConfig
): LinkPreviewFetcherPort {
  const client = createWebAgentServiceClient(config);

  return {
    async fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>> {
      const result = await client.fetchPreview(url);
      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        value: {
          url: result.value.url,
          ...(result.value.title !== undefined ? { title: result.value.title } : {}),
          ...(result.value.description !== undefined
            ? { description: result.value.description }
            : {}),
          ...(result.value.image !== undefined ? { image: result.value.image } : {}),
          ...(result.value.favicon !== undefined ? { favicon: result.value.favicon } : {}),
          ...(result.value.siteName !== undefined ? { siteName: result.value.siteName } : {}),
        },
      };
    },
  };
}
