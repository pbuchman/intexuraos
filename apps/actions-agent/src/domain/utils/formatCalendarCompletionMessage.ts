import type { CalendarPreview } from '../ports/calendarServiceClient.js';
import { formatDateTime } from './calendarMessageFormatting.js';

export interface FormatCalendarCompletionMessageParams {
  preview: CalendarPreview | null;
  fallbackMessage: string;
}

/**
 * Format a rich calendar completion message with event details.
 * Falls back to a basic message when preview is unavailable or failed.
 * The calendar URL is passed separately as a CTA button, not embedded in the message text.
 */
export function formatCalendarCompletionMessage(params: FormatCalendarCompletionMessageParams): string {
  const { preview, fallbackMessage } = params;

  if (
    preview?.status !== 'ready' ||
    preview.summary === undefined
  ) {
    return `\u{1F4C5} ${fallbackMessage}`;
  }

  const lines: string[] = ['\u2705 Calendar Event Created', ''];

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

  return lines.join('\n');
}
