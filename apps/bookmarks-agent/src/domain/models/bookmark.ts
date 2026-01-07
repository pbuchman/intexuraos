export type OgFetchStatus = 'pending' | 'processed' | 'failed';

export interface OpenGraphPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  type: string | null;
  favicon: string | null;
}

export interface Bookmark {
  id: string;
  userId: string;

  url: string;
  title: string | null;
  description: string | null;
  tags: string[];

  ogPreview: OpenGraphPreview | null;
  ogFetchedAt: Date | null;
  ogFetchStatus: OgFetchStatus;

  aiSummary: string | null;
  aiSummarizedAt: Date | null;

  source: string;
  sourceId: string;

  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookmarkInput {
  userId: string;
  url: string;
  title?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  source: string;
  sourceId: string;
}

export interface UpdateBookmarkInput {
  title?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  archived?: boolean | undefined;
}

export interface UpdateBookmarkInternalInput extends UpdateBookmarkInput {
  aiSummary?: string | undefined;
  ogPreview?: OpenGraphPreview | undefined;
  ogFetchStatus?: OgFetchStatus | undefined;
}

export interface BookmarkFilters {
  archived?: boolean | undefined;
  tags?: string[] | undefined;
  ogFetchStatus?: OgFetchStatus | undefined;
}

export type BookmarkErrorCode = 'NOT_FOUND' | 'STORAGE_ERROR' | 'INVALID_OPERATION' | 'DUPLICATE_URL';

export interface BookmarkError {
  code: BookmarkErrorCode;
  message: string;
}
