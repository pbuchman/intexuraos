import type { Result } from '@intexuraos/common-core';
import type { PageSummary, PageSummaryError } from '../models/PageSummary.js';

export interface SummarizeOptions {
  maxSentences?: number;
  maxReadingMinutes?: number;
}

export interface PageSummaryServicePort {
  summarizePage(
    url: string,
    options?: SummarizeOptions
  ): Promise<Result<PageSummary, PageSummaryError>>;
}
