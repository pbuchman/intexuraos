import type { Result } from '@intexuraos/common-core';

export interface CreateBookmarkRequest {
  userId: string;
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  source: string;
  sourceId: string;
}

export interface CreateBookmarkResponse {
  id: string;
  userId: string;
  url: string;
  title: string | null;
}

export interface BookmarksServiceClient {
  createBookmark(request: CreateBookmarkRequest): Promise<Result<CreateBookmarkResponse>>;
}
