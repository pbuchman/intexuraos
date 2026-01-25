/**
 * Zod schemas for calendar event extraction.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';

/**
 * ISO 8601 date-time string validator.
 * Accepts formats like: 2026-01-25T10:00:00, 2026-01-25T10:00:00Z, 2026-01-25T10:00:00+00:00
 * Validates that the date is actually valid (e.g., rejects 2026-13-25).
 */
const isoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?$/,
    'Invalid ISO 8601 date-time format'
  )
  .refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, 'Invalid date value (e.g., month 13, day 32, hour 25)');

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
