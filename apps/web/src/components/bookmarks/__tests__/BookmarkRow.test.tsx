/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookmarkRow } from '../BookmarkRow.js';
import type { Bookmark } from '@/types';

function createBookmark(overrides?: Partial<Bookmark>): Bookmark {
  return {
    id: 'bookmark-1',
    userId: 'user-1',
    url: 'https://example.com/a/very/long/path/that/should/not/crowd/the/title',
    title: 'A very long bookmark title that needs most of the mobile viewport',
    description: 'A useful description for the saved page',
    tags: ['payments', 'infra', 'apis'],
    ogPreview: null,
    ogFetchedAt: null,
    ogFetchStatus: 'processed',
    aiSummary: null,
    aiSummarizedAt: null,
    source: 'whatsapp_text',
    sourceId: 'action-1',
    archived: false,
    createdAt: '2026-06-10T07:18:52.951Z',
    updatedAt: '2026-06-10T07:18:52.951Z',
    ...overrides,
  };
}

describe('BookmarkRow', () => {
  it('uses a mobile-first layout that gives title and URL the main row width', () => {
    render(
      <BookmarkRow
        bookmark={createBookmark()}
        onOpen={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onTagClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('bookmark-row-layout')).toHaveClass(
      'grid-cols-[40px_minmax(0,1fr)]',
      'sm:grid-cols-[40px_minmax(0,1fr)_auto_140px_80px]'
    );
    expect(screen.getByTestId('bookmark-row-main')).toHaveClass('min-w-0');
    expect(screen.getByTestId('bookmark-row-title-line')).toHaveClass('min-w-0');
    expect(screen.getByTestId('bookmark-row-title')).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(screen.getByTestId('bookmark-row-url')).toHaveClass('truncate');
    expect(screen.getByTestId('bookmark-row-tags')).toHaveClass('col-start-2', 'sm:col-start-auto');
    expect(screen.getByTestId('bookmark-row-mobile-date')).toHaveClass('sm:hidden');
    expect(screen.getByTestId('bookmark-row-desktop-date')).toHaveClass('hidden', 'sm:block');
  });
});
