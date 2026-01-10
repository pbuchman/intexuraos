import type { Result } from '@intexuraos/common-core';
import type { OpenGraphPreview } from '../domain/models/bookmark.js';
import type {
  LinkPreviewFetcherPort,
  LinkPreviewError,
} from '../domain/ports/linkPreviewFetcher.js';

export class FakeLinkPreviewFetcher implements LinkPreviewFetcherPort {
  private nextResult: Result<OpenGraphPreview, LinkPreviewError> | null = null;
  private defaultPreview: OpenGraphPreview = {
    title: 'Test Title',
    description: 'Test Description',
    image: 'https://example.com/image.jpg',
    siteName: 'Example Site',
    type: null,
    favicon: 'https://example.com/favicon.ico',
  };
  public fetchPreviewCalls: string[] = [];

  setNextResult(result: Result<OpenGraphPreview, LinkPreviewError>): void {
    this.nextResult = result;
  }

  setDefaultPreview(preview: OpenGraphPreview): void {
    this.defaultPreview = preview;
  }

  async fetchPreview(url: string): Promise<Result<OpenGraphPreview, LinkPreviewError>> {
    this.fetchPreviewCalls.push(url);

    if (this.nextResult !== null) {
      const result = this.nextResult;
      this.nextResult = null;
      return result;
    }

    return { ok: true, value: this.defaultPreview };
  }

  clear(): void {
    this.fetchPreviewCalls = [];
    this.nextResult = null;
  }
}
