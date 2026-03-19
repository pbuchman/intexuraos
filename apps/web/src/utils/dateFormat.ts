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
  const absDiffMs = Math.abs(diffMs);
  const isFuture = diffMs < 0;

  const absDiffSeconds = Math.floor(absDiffMs / 1000);
  const absDiffMinutes = Math.floor(absDiffSeconds / 60);
  const absDiffHours = Math.floor(absDiffMinutes / 60);
  const absDiffDays = Math.floor(absDiffHours / 24);

  if (absDiffSeconds < 60) return isFuture ? 'in < 1m' : 'just now';
  if (absDiffMinutes < 60) {
    return isFuture ? `in ${String(absDiffMinutes)}m` : `${String(absDiffMinutes)}m ago`;
  }
  if (absDiffHours < 24) {
    return isFuture ? `in ${String(absDiffHours)}h` : `${String(absDiffHours)}h ago`;
  }
  if (absDiffDays < 7) {
    return isFuture ? `in ${String(absDiffDays)}d` : `${String(absDiffDays)}d ago`;
  }

  // Older/further than 7 days: show absolute date
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
 * Format relative time from a nullable ISO date string.
 * Returns 'Never' for null values. Supports future dates.
 * Use for: Cron schedule next/last execution timestamps
 */
export function formatRelativeNullable(isoDate: string | null): string {
  if (isoDate === null) return 'Never';
  return formatRelative(isoDate);
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
 * Format month and year as "January 2025"
 * Use for: Calendar month headers
 */
export function formatMonthYear(year: number, month: number): string {
  const date = new Date(year, month, 1);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
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

/**
 * Format elapsed time as human-friendly "5s" / "3m 5s" / "1h 30m"
 * Use for: Task duration display, elapsed time indicators
 */
export function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${String(minutes)}m ${String(remainingSeconds)}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours)}h ${String(remainingMinutes)}m`;
}

/**
 * Format duration in milliseconds as human-friendly string.
 * Returns '-' for null. Examples: "150ms", "3.2s", "2m 15s"
 * Use for: Execution duration, API call timing
 */
export function formatDurationMs(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${String(minutes)}m ${String(remaining)}s`;
}

/**
 * Format time only as "14:30:45" (24-hour format with seconds)
 * Use for: Event logs, DevBar, precise timestamps
 */
export function formatTimeOnly(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
