import type { CalendarPreview } from '../ports/calendarServiceClient.js';
import { formatDateTime } from './calendarMessageFormatting.js';

export interface FormatCalendarApprovalMessageParams {
  preview: CalendarPreview | null;
  actionTitle: string;
  actionId: string;
  webAppUrl: string;
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
