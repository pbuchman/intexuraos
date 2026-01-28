/**
 * Centralized date formatting utilities for apps/web.
 *
 * All date/time displays should use these functions instead of
 * local toLocaleDateString/toLocaleString calls.
 */

/**
 * Format date as "Jan 15, 2025"
 * Use for: List items, cards, any compact display
 */
export function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date with time as "Jan 15, 2025, 2:30 PM"
 * Use for: Detail views, modals, anywhere precision matters
 */
export function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format as relative time for recent items, absolute for older:
 * - "just now" (< 1 minute)
 * - "5m ago" (< 1 hour)
 * - "2h ago" (< 1 day)
 * - "3d ago" (< 7 days)
 * - "Jan 15" (≥ 7 days, same year)
 * - "Jan 15, 2024" (≥ 7 days, different year)
 *
 * Use for: Status indicators, recent items, feeds
 */
export function formatRelative(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`;
  if (diffHours < 24) return `${String(diffHours)}h ago`;
  if (diffDays < 7) return `${String(diffDays)}d ago`;

  // Older than 7 days: show absolute date
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date for HTML <input type="date"> value as "2025-01-15"
 * Use for: Date input fields in forms
 */
export function formatDateForInput(isoDate: string | null): string {
  if (isoDate === null) return '';
  return new Date(isoDate).toISOString().split('T')[0] ?? '';
}

/**
 * Format month from "2025-01" string as "Jan 2025"
 * Use for: Month labels, cost summaries
 */
export function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  if (year === undefined || month === undefined) return yearMonth;
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format week range as "Jan 15 - Jan 21, 2025"
 * Use for: Calendar week headers
 */
export function formatWeekRange(startDate: Date, endDate: Date): string {
  const startStr = startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const lastDayOfWeek = new Date(endDate);
  lastDayOfWeek.setDate(lastDayOfWeek.getDate() - 1);
  const endStr = lastDayOfWeek.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} - ${endStr}`;
}

/**
 * Format time as "2:30 PM" or "All day"
 * Use for: Calendar events
 */
export function formatTime(isoDate: string | undefined, isAllDay: boolean): string {
  if (isAllDay || isoDate === undefined) return 'All day';
  const date = new Date(isoDate);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format all-day event as "Monday, January 15, 2025"
 * Use for: Calendar preview cards
 */
export function formatFullDay(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format duration in seconds as "3:45" (minutes:seconds)
 * Use for: Audio player duration display
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes)}:${String(secs).padStart(2, '0')}`;
}
