import type { Result } from '@intexuraos/common-core';
import type { LinkPreview, LinkPreviewError } from '../models/LinkPreview.js';

export interface LinkPreviewFetcherPort {
  fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>>;
}
