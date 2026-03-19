import type { Bookmark as BookmarkType, OgFetchStatus } from '@/types';

export function truncateText(text: string, maxLength = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength).trim() + '...';
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function getDisplayTitle(bookmark: BookmarkType): string {
  if (bookmark.title !== null && bookmark.title !== '') {
    return bookmark.title;
  }
  if (bookmark.ogPreview?.title !== undefined && bookmark.ogPreview.title !== '') {
    return bookmark.ogPreview.title;
  }
  return getHostname(bookmark.url);
}

export function getDisplayDescription(bookmark: BookmarkType): string | null {
  if (bookmark.aiSummary !== null && bookmark.aiSummary !== '') {
    return bookmark.aiSummary;
  }
  if (bookmark.description !== null && bookmark.description !== '') {
    return bookmark.description;
  }
  if (bookmark.ogPreview?.description !== undefined && bookmark.ogPreview.description !== '') {
    return bookmark.ogPreview.description;
  }
  return null;
}

export const OG_STATUS_STYLES: Record<OgFetchStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/50', text: 'text-yellow-700 dark:text-yellow-300', label: 'Fetching...' },
  processed: { bg: 'bg-green-100 dark:bg-green-900/50', text: 'text-green-700 dark:text-green-300', label: 'Loaded' },
  failed: { bg: 'bg-red-100 dark:bg-red-900/50', text: 'text-red-700 dark:text-red-300', label: 'Failed' },
};

interface OgStatusBadgeProps {
  status: OgFetchStatus;
}

export function OgStatusBadge({ status }: OgStatusBadgeProps): React.JSX.Element | null {
  if (status === 'processed') {
    return null;
  }
  const style = OG_STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

export type BookmarkSortOption = 'created' | 'title' | 'updated';
export const BOOKMARK_SORT_OPTIONS: { key: BookmarkSortOption; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'title', label: 'Title' },
  { key: 'updated', label: 'Updated' },
];

export const BOOKMARKS_SORT_KEY = 'bookmarks-sort';

export function createBackdropClickHandler(onClose: () => void) {
  return (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };
}
