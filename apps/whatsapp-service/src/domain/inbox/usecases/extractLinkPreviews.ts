/**
 * Use case for extracting link previews from message text.
 *
 * Handles the complete link preview workflow:
 * 1. Extract URLs from message text
 * 2. Fetch Open Graph metadata for each URL (max 3)
 * 3. Update message with link previews
 *
 * Designed to be called fire-and-forget after webhook returns 200.
 * All errors are handled internally and logged.
 */
import type { LinkPreviewState, LinkPreview } from '../models/LinkPreview.js';
import type { WhatsAppMessageRepository } from '../ports/repositories.js';
import type { LinkPreviewFetcherPort } from '../ports/linkPreviewFetcher.js';

/**
 * Maximum number of URLs to process per message.
 */
const MAX_URLS_PER_MESSAGE = 3;

/**
 * Regex pattern for detecting URLs in text.
 */
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Input for extracting link previews.
 */
export interface ExtractLinkPreviewsInput {
  messageId: string;
  userId: string;
  text: string;
}

/**
 * Logger interface for the use case.
 */
export interface ExtractLinkPreviewsLogger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

/**
 * Dependencies for ExtractLinkPreviewsUseCase.
 */
export interface ExtractLinkPreviewsDeps {
  messageRepository: WhatsAppMessageRepository;
  linkPreviewFetcher: LinkPreviewFetcherPort;
}

/**
 * Extract URLs from text.
 * Returns up to MAX_URLS_PER_MESSAGE unique URLs.
 */
function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (matches === null) {
    return [];
  }

  // Deduplicate and limit
  const uniqueUrls = [...new Set(matches)];
  return uniqueUrls.slice(0, MAX_URLS_PER_MESSAGE);
}

/**
 * Use case for extracting link previews from message text.
 */
export class ExtractLinkPreviewsUseCase {
  constructor(private readonly deps: ExtractLinkPreviewsDeps) {}

  /**
   * Execute the link preview extraction workflow.
   *
   * This method is designed to be called fire-and-forget (void return).
   * All errors are handled internally and stored in the message.
   *
   * @param input - Message details
   * @param logger - Logger for tracking progress
   */
  async execute(input: ExtractLinkPreviewsInput, logger: ExtractLinkPreviewsLogger): Promise<void> {
    const { messageRepository, linkPreviewFetcher } = this.deps;
    const { messageId, userId, text } = input;
    const startedAt = new Date().toISOString();

    // Extract URLs from text
    const urls = extractUrls(text);

    if (urls.length === 0) {
      logger.info(
        { event: 'link_preview_no_urls', messageId, userId },
        'No URLs found in message, skipping link preview extraction'
      );
      return;
    }

    logger.info(
      { event: 'link_preview_start', messageId, userId, urlCount: urls.length },
      'Starting link preview extraction'
    );

    // Initialize link preview state as pending
    const initialState: LinkPreviewState = {
      status: 'pending',
      startedAt,
    };
    await messageRepository.updateLinkPreview(userId, messageId, initialState);

    try {
      // Fetch previews for all URLs in parallel
      const previewResults = await Promise.all(
        urls.map(async (url) => {
          const result = await linkPreviewFetcher.fetchPreview(url);
          if (result.ok) {
            return result.value;
          }
          logger.error(
            { event: 'link_preview_fetch_failed', messageId, url, error: result.error },
            `Failed to fetch preview for ${url}`
          );
          return null;
        })
      );

      // Filter out failed fetches
      const successfulPreviews = previewResults.filter(
        (preview): preview is LinkPreview => preview !== null
      );

      if (successfulPreviews.length === 0) {
        // All fetches failed
        const errorState: LinkPreviewState = {
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          error: {
            code: 'FETCH_FAILED',
            message: `Failed to fetch previews for all ${String(urls.length)} URLs`,
          },
        };
        await messageRepository.updateLinkPreview(userId, messageId, errorState);
        logger.error(
          { event: 'link_preview_all_failed', messageId, userId, urlCount: urls.length },
          'All link preview fetches failed'
        );
        return;
      }

      // Update message with successful previews
      const completedState: LinkPreviewState = {
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        previews: successfulPreviews,
      };
      await messageRepository.updateLinkPreview(userId, messageId, completedState);

      logger.info(
        {
          event: 'link_preview_completed',
          messageId,
          userId,
          previewCount: successfulPreviews.length,
          totalUrls: urls.length,
        },
        `Link preview extraction completed: ${String(successfulPreviews.length)}/${String(urls.length)} successful`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorState: LinkPreviewState = {
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        error: {
          code: 'FETCH_FAILED',
          message: errorMessage,
        },
      };
      await messageRepository.updateLinkPreview(userId, messageId, errorState);
      logger.error(
        { event: 'link_preview_error', messageId, userId, error: errorMessage },
        'Link preview extraction failed with unexpected error'
      );
    }
  }
}
