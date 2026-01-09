import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  Bookmark,
  CreateBookmarkRequest,
  UpdateBookmarkRequest,
  OgFetchStatus,
} from '@/types';

export interface ListBookmarksFilters {
  archived?: boolean;
  tags?: string[];
  ogFetchStatus?: OgFetchStatus;
}

function buildQueryString(filters: ListBookmarksFilters): string {
  const params = new URLSearchParams();
  if (filters.archived !== undefined) {
    params.set('archived', String(filters.archived));
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    params.set('tags', filters.tags.join(','));
  }
  if (filters.ogFetchStatus !== undefined) {
    params.set('ogFetchStatus', filters.ogFetchStatus);
  }
  const query = params.toString();
  return query !== '' ? `?${query}` : '';
}

export async function listBookmarks(
  accessToken: string,
  filters: ListBookmarksFilters = {}
): Promise<Bookmark[]> {
  const query = buildQueryString(filters);
  return await apiRequest<Bookmark[]>(config.bookmarksAgentUrl, `/bookmarks${query}`, accessToken);
}

export async function createBookmark(
  accessToken: string,
  request: CreateBookmarkRequest
): Promise<Bookmark> {
  return await apiRequest<Bookmark>(config.bookmarksAgentUrl, '/bookmarks', accessToken, {
    method: 'POST',
    body: request,
  });
}

export async function getBookmark(accessToken: string, id: string): Promise<Bookmark> {
  return await apiRequest<Bookmark>(config.bookmarksAgentUrl, `/bookmarks/${id}`, accessToken);
}

export async function updateBookmark(
  accessToken: string,
  id: string,
  request: UpdateBookmarkRequest
): Promise<Bookmark> {
  return await apiRequest<Bookmark>(config.bookmarksAgentUrl, `/bookmarks/${id}`, accessToken, {
    method: 'PATCH',
    body: request,
  });
}

export async function deleteBookmark(accessToken: string, id: string): Promise<void> {
  await apiRequest<Record<string, never>>(
    config.bookmarksAgentUrl,
    `/bookmarks/${id}`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

export async function archiveBookmark(accessToken: string, id: string): Promise<Bookmark> {
  return await apiRequest<Bookmark>(
    config.bookmarksAgentUrl,
    `/bookmarks/${id}/archive`,
    accessToken,
    {
      method: 'POST',
    }
  );
}

export async function unarchiveBookmark(accessToken: string, id: string): Promise<Bookmark> {
  return await apiRequest<Bookmark>(
    config.bookmarksAgentUrl,
    `/bookmarks/${id}/unarchive`,
    accessToken,
    {
      method: 'POST',
    }
  );
}
