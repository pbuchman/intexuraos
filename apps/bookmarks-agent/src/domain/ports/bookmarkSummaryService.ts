import type { Result } from '@intexuraos/common-core';

export interface BookmarkContent {
  url: string;
  title: string | null;
  description: string | null;
}

export interface SummaryError {
  code: 'NO_API_KEY' | 'USER_SERVICE_ERROR' | 'GENERATION_ERROR' | 'NO_CONTENT';
  message: string;
}

export interface BookmarkSummaryService {
  generateSummary(
    userId: string,
    content: BookmarkContent
  ): Promise<Result<string, SummaryError>>;
}
