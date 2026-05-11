import type { Result } from '@intexuraos/common-core';
import type {
  NotionPagePreview as SharedNotionPagePreview,
  NotionTokenContext as SharedNotionTokenContext,
} from '@intexuraos/http-contracts';
import type { Logger } from 'pino';

export interface NotionServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export type NotionTokenContext = SharedNotionTokenContext;

export type PagePreview = SharedNotionPagePreview;

export interface NotionServiceError {
  code: 'UNAUTHORIZED' | 'DOWNSTREAM_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'UNAVAILABLE';
  message: string;
}

export interface NotionServiceClient {
  getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>>;
  getPagePreview(userId: string, pageId: string): Promise<Result<PagePreview, NotionServiceError>>;
}

export type NotionPagePreviewLogger = Logger;
