/**
 * Port for fetching link previews (Open Graph metadata).
 * Abstracts HTTP fetching and HTML parsing for the domain layer.
 */
import type { Result } from '@intexuraos/common-core';
import type { LinkPreview, LinkPreviewError } from '../models/LinkPreview.js';

/**
 * Port for fetching link preview metadata.
 */
export interface LinkPreviewFetcherPort {
  /**
   * Fetch Open Graph metadata for a URL.
   *
   * @param url - URL to fetch preview for
   * @returns Link preview data or error
   */
  fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>>;
}
