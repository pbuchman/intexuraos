import type { Result } from '@intexuraos/common-core';
import type {
  Bookmark,
  CreateBookmarkInput,
  BookmarkFilters,
  BookmarkError,
} from '../models/bookmark.js';

export interface BookmarkRepository {
  create(input: CreateBookmarkInput): Promise<Result<Bookmark, BookmarkError>>;
  findById(id: string): Promise<Result<Bookmark | null, BookmarkError>>;
  findByUserId(
    userId: string,
    filters?: BookmarkFilters
  ): Promise<Result<Bookmark[], BookmarkError>>;
  findByUserIdAndUrl(userId: string, url: string): Promise<Result<Bookmark | null, BookmarkError>>;
  update(id: string, bookmark: Bookmark): Promise<Result<Bookmark, BookmarkError>>;
  delete(id: string): Promise<Result<void, BookmarkError>>;
}
