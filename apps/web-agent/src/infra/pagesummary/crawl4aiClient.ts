import { err, ok, type Result } from '@intexuraos/common-core';
import type { PageSummaryServicePort, SummarizeOptions } from '../../domain/pagesummary/ports/pageSummaryService.js';
import type { PageSummary, PageSummaryError } from '../../domain/pagesummary/models/PageSummary.js';
import type { Logger } from 'pino';

export interface Crawl4AIClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: Omit<Crawl4AIClientConfig, 'apiKey'> = {
  baseUrl: 'https://api.crawl4ai.com',
  timeoutMs: 120000,
};

const DEFAULT_MAX_SENTENCES = 20;
const DEFAULT_MAX_READING_MINUTES = 3;
const WORDS_PER_MINUTE = 200;

interface Crawl4AIResponse {
  success: boolean;
  url?: string;
  html?: string;
  cleaned_html?: string;
  markdown?: {
    raw_markdown?: string;
  };
  extracted_content?: string;
  error_message?: string;
  status_code?: number;
  duration_ms?: number;
  crawl_strategy?: string;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function calculateReadingMinutes(wordCount: number): number {
  return Math.ceil(wordCount / WORDS_PER_MINUTE);
}

/** Returns undefined for empty/whitespace-only strings, enabling ?? fallback */
function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim() !== '' ? value : undefined;
}

function buildSummaryPrompt(maxSentences: number, maxReadingMinutes: number): string {
  const maxWords = maxReadingMinutes * WORDS_PER_MINUTE;
  return `Summarize this web page content. Requirements:
- Maximum ${String(maxSentences)} sentences
- Maximum ${String(maxWords)} words (approximately ${String(maxReadingMinutes)} minutes of reading)
- Extract all relevant points from the page
- If there are multiple subjects, provide pointed summaries for each specific topic
- Focus on key information, facts, and main ideas
- Use clear, concise language
- Do not include any meta-commentary about the summary itself`;
}

export class Crawl4AIClient implements PageSummaryServicePort {
  private readonly config: Crawl4AIClientConfig;
  private readonly logger: Logger;

  constructor(config: Partial<Crawl4AIClientConfig> & { apiKey: string }, logger: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  async summarizePage(
    url: string,
    options?: SummarizeOptions
  ): Promise<Result<PageSummary, PageSummaryError>> {
    const maxSentences = options?.maxSentences ?? DEFAULT_MAX_SENTENCES;
    const maxReadingMinutes = options?.maxReadingMinutes ?? DEFAULT_MAX_READING_MINUTES;

    this.logger.info({ url, maxSentences, maxReadingMinutes }, 'Starting page summarization');

    const controller = new AbortController();
    const timeoutId = setTimeout((): void => {
      this.logger.warn({ url, timeoutMs: this.config.timeoutMs }, 'Request timed out');
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const prompt = buildSummaryPrompt(maxSentences, maxReadingMinutes);

      // Crawl4AI Cloud API v1 uses /v1/crawl endpoint with X-API-Key header
      const payload = {
        url,
        strategy: 'browser',
        crawler_config: {
          extraction_strategy: {
            type: 'llm',
            instruction: prompt,
          },
        },
        bypass_cache: true,
      };

      const response = await fetch(`${this.config.baseUrl}/v1/crawl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(
          {
            url,
            status: response.status,
            statusText: response.statusText,
          },
          'Crawl4AI API error response'
        );
        return err({
          code: 'API_ERROR',
          message: `Crawl4AI API error: HTTP ${String(response.status)}`,
        });
      }

      const data = (await response.json()) as Crawl4AIResponse;

      if (!data.success) {
        this.logger.warn({ url, error: data.error_message }, 'Crawl4AI extraction failed');
        return err({
          code: 'FETCH_FAILED',
          message: data.error_message ?? 'Crawl4AI extraction failed',
        });
      }

      // New API returns LLM extraction in 'extracted_content', fallback to markdown
      // Use nonEmpty() to also fallback on empty strings (not just null/undefined)
      const extractedContent =
        nonEmpty(data.extracted_content) ?? nonEmpty(data.markdown?.raw_markdown);

      this.logger.debug(
        {
          url,
          hasExtractedContent: data.extracted_content !== undefined,
          hasMarkdown: data.markdown?.raw_markdown !== undefined,
          crawlStrategy: data.crawl_strategy,
          durationMs: data.duration_ms,
          responseKeys: Object.keys(data),
        },
        'Crawl4AI response fields'
      );

      if (extractedContent === undefined || extractedContent.trim() === '') {
        this.logger.warn({ url }, 'No content extracted from page');
        return err({
          code: 'NO_CONTENT',
          message: 'No content could be extracted from the page',
        });
      }

      const summary = extractedContent.trim();
      const wordCount = countWords(summary);
      const estimatedReadingMinutes = calculateReadingMinutes(wordCount);

      this.logger.info(
        {
          url,
          wordCount,
          estimatedReadingMinutes,
          summaryLength: summary.length,
        },
        'Page summarization completed successfully'
      );

      return ok({
        url,
        summary,
        wordCount,
        estimatedReadingMinutes,
      });
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          this.logger.warn({ url, timeoutMs: this.config.timeoutMs }, 'Request timed out (AbortError)');
          return err({
            code: 'TIMEOUT',
            message: `Request timed out after ${String(this.config.timeoutMs)}ms`,
          });
        }

        this.logger.error({ url, error: error.message }, 'Crawl4AI request failed');
        return err({
          code: 'FETCH_FAILED',
          message: error.message,
        });
      }

      this.logger.error({ url }, 'Unknown error during Crawl4AI request');
      return err({
        code: 'FETCH_FAILED',
        message: 'Unknown error',
      });
    }
  }
}

export function createCrawl4AIClient(
  config: Partial<Crawl4AIClientConfig> & { apiKey: string },
  logger: Logger
): PageSummaryServicePort {
  return new Crawl4AIClient(config, logger);
}
