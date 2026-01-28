import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type {
  BookmarkSummaryService,
  BookmarkContent,
  SummaryError,
} from '../domain/ports/bookmarkSummaryService.js';

export class FakeBookmarkSummaryService implements BookmarkSummaryService {
  public generateSummaryCalls: { userId: string; content: BookmarkContent }[] = [];
  private defaultSummary = 'This is a test summary of the page content.';
  private nextError: SummaryError | null = null;

  setDefaultSummary(summary: string): void {
    this.defaultSummary = summary;
  }

  setNextError(error: Omit<SummaryError, 'transient'> & { transient?: boolean }): void {
    this.nextError = error;
  }

  async generateSummary(
    userId: string,
    content: BookmarkContent
  ): Promise<Result<string, SummaryError>> {
    this.generateSummaryCalls.push({ userId, content });

    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      return err(error);
    }

    return ok(this.defaultSummary);
  }

  clear(): void {
    this.generateSummaryCalls = [];
    this.defaultSummary = 'This is a test summary of the page content.';
    this.nextError = null;
  }
}
