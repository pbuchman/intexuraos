import type { Result } from '@intexuraos/common-core';

export interface ImageProxyError {
  code: 'INVALID_URL' | 'NOT_AN_IMAGE' | 'FETCH_FAILED' | 'TIMEOUT' | 'PROXY_ERROR';
  message: string;
  httpStatus: number;
}

export interface ImageProxyResult {
  buffer: Buffer;
  contentType: string;
}

export interface ImageProxyPort {
  proxyImage(encodedUrl: string): Promise<Result<ImageProxyResult, ImageProxyError>>;
}
