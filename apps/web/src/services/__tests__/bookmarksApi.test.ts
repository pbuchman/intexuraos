/**
 * Tests for bookmarksApi service.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listBookmarks } from '../bookmarksApi.js';
import type { Bookmark } from '../../types/index.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    bookmarksAgentUrl: 'https://bookmarks.test',
  },
}));

const TOKEN = 'tok';

const sampleBookmark: Bookmark = {
  id: 'bookmark-1',
  userId: 'user-1',
  url: 'https://example.com',
  title: 'Example',
  description: null,
  tags: ['docs'],
  ogPreview: null,
  ogFetchedAt: null,
  ogFetchStatus: 'pending',
  aiSummary: null,
  aiSummarizedAt: null,
  source: 'manual',
  sourceId: 'src-1',
  archived: false,
  createdAt: '2026-04-26T00:00:00Z',
  updatedAt: '2026-04-26T00:00:00Z',
};

describe('bookmarksApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listBookmarks', () => {
    it('GETs / with no query when filters empty', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue([sampleBookmark]);

      const result = await listBookmarks(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://bookmarks.test');
      expect(call?.[1]).toBe('/');
      expect(call?.[2]).toBe(TOKEN);
      expect(result).toEqual([sampleBookmark]);
    });

    it('builds querystring from filters', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue([]);

      await listBookmarks(TOKEN, {
        archived: true,
        tags: ['docs', 'api'],
        ogFetchStatus: 'processed',
      });

      const call = vi.mocked(apiRequest).mock.calls[0];
      const path = call?.[1] ?? '';
      expect(path.startsWith('/?')).toBe(true);
      expect(path).toContain('archived=true');
      expect(path).toContain('tags=docs%2Capi');
      expect(path).toContain('ogFetchStatus=processed');
    });
  });
});
