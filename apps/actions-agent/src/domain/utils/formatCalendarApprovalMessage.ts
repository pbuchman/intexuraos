import type { CalendarPreview } from '../ports/calendarServiceClient.js';

export interface FormatCalendarApprovalMessageParams {
  preview: CalendarPreview | null;
  actionTitle: string;
  actionId: string;
  webAppUrl: string;
}

/**
 * Format a date/time string for display in WhatsApp messages.
 * Handles both ISO datetime strings and date-only strings (all-day events).
 */
function formatDateTime(start?: string, end?: string | null, isAllDay?: boolean): string | null {
  if (start === undefined) {
    return null;
  }

  if (isAllDay === true) {
    try {
      const date = new Date(start + 'T00:00:00');
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }) + ' (All day)';
    } catch {
      return null;
    }
  }

  try {
    const startDate = new Date(start);
    const dateStr = startDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const startTime = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (end !== null && end !== undefined) {
      const endDate = new Date(end);
      const endTime = endDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `${dateStr} \u00b7 ${startTime} \u2013 ${endTime}`;
    }

    return `${dateStr} \u00b7 ${startTime}`;
  } catch {
    return null;
  }
}

/**
 * Format a rich calendar approval message with event details.
 * Falls back to a basic message when preview is unavailable or failed.
 */
export function formatCalendarApprovalMessage(params: FormatCalendarApprovalMessageParams): string {
  const { preview, actionTitle, actionId, webAppUrl } = params;
  const reviewUrl = `${webAppUrl}/#/inbox?action=${actionId}`;

  // Fallback: no preview or failed preview
  if (
    preview?.status !== 'ready' ||
    preview.summary === undefined
  ) {
    return `\u{1F4C5} New calendar event ready for approval: "${actionTitle}"\n\nReview: ${reviewUrl}`;
  }

  const lines: string[] = ['\u{1F4C5} Calendar Event', ''];

  lines.push(`*${preview.summary}*`);

  const dateTimeStr = formatDateTime(preview.start, preview.end, preview.isAllDay);
  if (dateTimeStr !== null) {
    lines.push(`\u{1F4C6} ${dateTimeStr}`);
  }

  if (preview.duration !== null && preview.duration !== undefined) {
    lines.push(`\u23F1 ${preview.duration}`);
  }

  if (preview.location !== null && preview.location !== undefined) {
    lines.push(`\u{1F4CD} ${preview.location}`);
  }

  lines.push('');
  lines.push(`Review: ${reviewUrl}`);

  return lines.join('\n');
}
