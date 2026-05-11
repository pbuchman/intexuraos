import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { OpenGraphPreview } from '../../domain/models/bookmark.js';
import type {
  LinkPreviewFetcherPort,
  LinkPreviewError,
} from '../../domain/ports/linkPreviewFetcher.js';
import type { Logger } from 'pino';
import { createWebAgentServiceClient } from '@intexuraos/internal-clients';

export interface WebAgentClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

export function createWebAgentClient(config: WebAgentClientConfig): LinkPreviewFetcherPort {
  const client = createWebAgentServiceClient(config);

  return {
    async fetchPreview(url: string): Promise<Result<OpenGraphPreview, LinkPreviewError>> {
      const result = await client.fetchPreview(url);
      if (!result.ok) {
        return result;
      }

      return ok({
        title: result.value.title ?? null,
        description: result.value.description ?? null,
        image: result.value.image ?? null,
        siteName: result.value.siteName ?? null,
        type: null,
        favicon: result.value.favicon ?? null,
      });
    },
  };
}
