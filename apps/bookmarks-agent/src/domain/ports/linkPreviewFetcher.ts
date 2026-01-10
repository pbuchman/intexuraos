import type { Result } from '@intexuraos/common-core';
import type { OpenGraphPreview } from '../models/bookmark.js';

export interface LinkPreviewError {
  code: 'FETCH_FAILED' | 'PARSE_FAILED' | 'TIMEOUT' | 'TOO_LARGE';
  message: string;
}

export interface LinkPreviewFetcherPort {
  fetchPreview(url: string): Promise<Result<OpenGraphPreview, LinkPreviewError>>;
}
