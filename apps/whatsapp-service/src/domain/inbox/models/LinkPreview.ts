/**
 * Link preview data extracted from Open Graph metadata.
 */
export interface LinkPreview {
  /**
   * Original URL.
   */
  url: string;

  /**
   * Page title (og:title or <title>).
   */
  title?: string;

  /**
   * Page description (og:description or meta description).
   */
  description?: string;

  /**
   * Preview image URL (og:image).
   */
  image?: string;

  /**
   * Site favicon URL.
   */
  favicon?: string;

  /**
   * Site name (og:site_name).
   */
  siteName?: string;
}

/**
 * Status of link preview extraction.
 */
export type LinkPreviewStatus = 'pending' | 'completed' | 'failed';

/**
 * Error information for failed link preview extraction.
 */
export interface LinkPreviewError {
  code: 'FETCH_FAILED' | 'PARSE_FAILED' | 'TIMEOUT' | 'TOO_LARGE';
  message: string;
}

/**
 * Link preview state for messages with URLs.
 * Tracks the extraction lifecycle.
 */
export interface LinkPreviewState {
  /**
   * Current extraction status.
   */
  status: LinkPreviewStatus;

  /**
   * Extracted link previews (when completed).
   */
  previews?: LinkPreview[];

  /**
   * Error details if extraction failed.
   */
  error?: LinkPreviewError;

  /**
   * When extraction started (ISO 8601).
   */
  startedAt?: string;

  /**
   * When extraction completed or failed (ISO 8601).
   */
  completedAt?: string;
}
