import type { Result } from '@intexuraos/common-core';
import type {
  ImageProxyPort,
  ImageProxyError,
  ImageProxyResult,
} from '../domain/ports/imageProxy.js';

export class FakeImageProxy implements ImageProxyPort {
  private nextResult: Result<ImageProxyResult, ImageProxyError> | null = null;

  setNextResult(value: ImageProxyResult): void {
    this.nextResult = { ok: true, value };
  }

  setNextError(error: ImageProxyError): void {
    this.nextResult = { ok: false, error };
  }

  async proxyImage(_encodedUrl: string): Promise<Result<ImageProxyResult, ImageProxyError>> {
    if (this.nextResult !== null) {
      return this.nextResult;
    }

    return {
      ok: true,
      value: { buffer: Buffer.from('fake-image'), contentType: 'image/jpeg' },
    };
  }
}
