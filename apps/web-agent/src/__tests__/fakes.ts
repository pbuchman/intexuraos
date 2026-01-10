import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  LinkPreviewFetcherPort,
  LinkPreview,
  LinkPreviewError,
} from '../domain/index.js';

export class FakeLinkPreviewFetcher implements LinkPreviewFetcherPort {
  private nextResult: Result<LinkPreview, LinkPreviewError> | null = null;
  private results = new Map<string, Result<LinkPreview, LinkPreviewError>>();

  async fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>> {
    if (this.nextResult !== null) {
      const result = this.nextResult;
      this.nextResult = null;
      return result;
    }

    const storedResult = this.results.get(url);
    if (storedResult !== undefined) {
      return storedResult;
    }

    return ok({
      url,
      title: 'Test Title',
      description: 'Test Description',
      image: 'https://example.com/image.jpg',
      siteName: 'Test Site',
    });
  }

  setNextResult(result: Result<LinkPreview, LinkPreviewError>): void {
    this.nextResult = result;
  }

  setResultForUrl(url: string, result: Result<LinkPreview, LinkPreviewError>): void {
    this.results.set(url, result);
  }

  setFailNext(errorCode: LinkPreviewError['code'], message?: string): void {
    this.nextResult = err({
      code: errorCode,
      message: message ?? `Test error: ${errorCode}`,
    });
  }

  clear(): void {
    this.nextResult = null;
    this.results.clear();
  }
}
