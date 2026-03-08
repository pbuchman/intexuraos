/**
 * Format a date/time string for display in WhatsApp messages.
 * Handles both ISO datetime strings and date-only strings (all-day events).
 */
export function formatDateTime(start?: string, end?: string | null, isAllDay?: boolean): string | null {
  if (start === undefined) {
    return null;
  }

  if (isAllDay === true) {
    try {
      const date = new Date(start + 'T12:00:00Z');
      if (isNaN(date.getTime())) {
        return null;
      }
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
    if (isNaN(startDate.getTime())) {
      return null;
    }
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
