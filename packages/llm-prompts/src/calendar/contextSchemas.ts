/**
 * Zod schemas for calendar event extraction.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';

/**
 * Validates that a date string represents a real date.
 * JavaScript's Date constructor is lenient (e.g., Feb 30 becomes Mar 2),
 * so we verify the parsed components match the input components.
 */
export function isValidDateString(val: string): boolean {
  const dateTimeForValidation = val.includes('T') ? val : `${val}T00:00:00`;
  const date = new Date(dateTimeForValidation);
  if (isNaN(date.getTime())) return false;

  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires ?? but String.split always returns at least one element @preserve */
  const datePart = val.split('T')[0] ?? '';
  /* v8 ignore stop @preserve */
  const parts = datePart.split('-');
  /* v8 ignore start -- schema: regex pre-validation guarantees YYYY-MM-DD, Date constructor rejects non-standard formats @preserve */
  if (parts.length !== 3) return false;
  /* v8 ignore stop @preserve */

  const [yearStr = '', monthStr = '', dayStr = ''] = parts;

  const inputYear = parseInt(yearStr, 10);
  const inputMonth = parseInt(monthStr, 10);
  const inputDay = parseInt(dayStr, 10);

  return (
    date.getFullYear() === inputYear &&
    date.getMonth() + 1 === inputMonth &&
    date.getDate() === inputDay
  );
}

/**
 * ISO 8601 date or date-time string validator.
 * Accepts formats like:
 * - Date-only: 2026-01-25 (for all-day events)
 * - DateTime: 2026-01-25T10:00:00, 2026-01-25T10:00:00Z, 2026-01-25T10:00:00+00:00
 * Validates that the date is actually valid (e.g., rejects 2026-13-25, 2026-02-30).
 */
const isoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?)?$/,
    'Invalid ISO 8601 date or date-time format'
  )
  .refine(isValidDateString, 'Invalid date value (e.g., month 13, day 32, Feb 30)');

/**
 * Schema for individual calendar event extracted from natural language.
 */
export const CalendarEventSchema = z.object({
  summary: z.string(),
  start: isoDateTimeSchema.nullable(),
  end: isoDateTimeSchema.nullable(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  valid: z.boolean(),
  error: z.string().nullable(),
  reasoning: z.string(),
});

// Export derived types
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

/**
 * Alias for CalendarEvent used by extraction services.
 * Provides semantic clarity when used in extraction context.
 */
export type ExtractedCalendarEvent = CalendarEvent;
