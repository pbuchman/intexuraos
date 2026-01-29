/**
 * Calendar event extraction prompt for parsing natural language into calendar events.
 * Used by calendar-agent to extract structured event data from user messages.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface CalendarEventExtractionPromptInput {
  /** The user message to extract calendar event from */
  text: string;
  /** Current date with day of week for relative date calculations (e.g., "2026-01-29 Wednesday") */
  currentDate: string;
}

export interface CalendarEventExtractionPromptDeps extends PromptDeps {
  /** Maximum description length (default: 1000) */
  maxDescriptionLength?: number;
}

/**
 * Extracted calendar event data.
 * All fields except summary are optional - missing data indicates incomplete input.
 */
export interface ExtractedCalendarEvent {
  /** Event title/summary (required) */
  summary: string;
  /** Event start time in ISO-8601 format (YYYY-MM-DDTHH:mm:ss) or date only (YYYY-MM-DD) */
  start: string | null;
  /** Event end time in ISO-8601 format (null if not specified) */
  end: string | null;
  /** Event location or meeting link (null if not specified) */
  location: string | null;
  /** Detailed event description (null if not specified) */
  description: string | null;
  /** Whether extraction was successful (all required fields present) */
  valid: boolean;
  /** Error message if extraction failed (null if successful) */
  error: string | null;
  /** Reasoning for extraction decisions */
  reasoning: string;
}

export const calendarActionExtractionPrompt: PromptBuilder<
  CalendarEventExtractionPromptInput,
  CalendarEventExtractionPromptDeps
> = {
  name: 'calendar-action-extraction',
  description: 'Extracts structured calendar event data from natural language text',

  build(
    input: CalendarEventExtractionPromptInput,
    deps?: CalendarEventExtractionPromptDeps
  ): string {
    const maxLength = deps?.maxDescriptionLength ?? 1000;
    const textPreview = input.text.length > maxLength ? input.text.slice(0, maxLength) : input.text;

    const truncationWarning =
      input.text.length > maxLength
        ? `\n\n⚠️ IMPORTANT: Text was truncated to first ${String(maxLength)} characters.\n`
        : '';

    // Extract date part from "YYYY-MM-DD DayOfWeek" format for template literal examples
    const parts = input.currentDate.split(' ');
    const datePart = parts[0] ?? input.currentDate;

    return `Extract calendar event information from the user's message.

CURRENT DATE: ${input.currentDate}

IMPORTANT: The current date includes the DAY OF WEEK. Use this to calculate relative dates.
Example: If current date is "2026-01-29 Wednesday", then:
- "jutro" (tomorrow) = 2026-01-30 Thursday
- "w następny czwartek" (next Thursday) = 2026-01-30 Thursday (same week)
- "w nastepny poniedzialek" (next Monday) = 2026-02-02 Monday (next week)

TASK: Parse the message and extract a structured calendar event.

RULES:
1. LANGUAGE: Maintain the SAME LANGUAGE as the user's message
   - English message → English summary/description
   - Polish message → Polish summary/description

2. DATE/TIME PARSING (from current date ${input.currentDate}):
   RELATIVE DATES (calculate from current date, including day of week):
   - "today" / "dziś" → ${datePart}
   - "tomorrow" / "jutro" → current date + 1 day
   - "day after tomorrow" / "pojutrze" → current date + 2 days
   - "in X days" / "za X dni" → current date + X days
   - "next [day]" / "następny [dzień]" → next occurrence of that weekday
     * "next Monday" / "następny poniedziałek" → find next Monday
     * "on Thursday" / "w czwartek" → this Thursday if upcoming, else next Thursday
   - "w nastepny [dzień tygodnia]" → same as "następny [dzień]"

   POLISH MONTH NAMES (you MUST recognize these):
   - stycznia = January, lutego = February, marca = March, kwietnia = April
   - maja = May, czerwca = June, lipca = July, sierpnia = August
   - września = September, października = October, listopada = November, grudnia = December

   TIME FORMATS:
   - "at 3pm" / "o 15:00" / "o 15 30" → parse as 24-hour time
   - "3pm tomorrow" / "jutro o 15" / "jutro o 15:30" → combine date + time
   - If no time specified → use 09:00 as default start time
   - If no end time specified → assume 1 hour duration

3. OUTPUT FORMAT:
   - Dates with time: ISO-8601 format (YYYY-MM-DDTHH:mm:ss)
   - Dates without time: YYYY-MM-DD (all-day event)
   - Times in 24-hour format when parsing (e.g., 3pm → 15:00)

4. REQUIRED FIELDS:
   - summary: ALWAYS extract/create a title (use message content if no explicit title)
   - start: REQUIRED for valid event (null if unparseable)

5. OPTIONAL FIELDS (use null if not found):
   - end: End time (null if not specified)
   - location: Physical address, venue name, or online meeting link
   - description: Additional details from the message

6. VALIDATION:
   - valid = true ONLY if summary and start are both present and parseable
   - valid = false if missing critical information (what/when)
   - error: Brief explanation of what's missing when invalid (in same language as input)

EXAMPLES (ENGLISH):

Input: "Meeting with John tomorrow at 3pm"
Output:
{
  "summary": "Meeting with John",
  "start": "2024-01-16T15:00:00",
  "end": "2024-01-16T16:00:00",
  "location": null,
  "description": null,
  "valid": true,
  "error": null,
  "reasoning": "Extracted clear title, date (tomorrow), and time (3pm)"
}

Input: "Lunch at Pizza Hut on Friday at 12:30"
Output:
{
  "summary": "Lunch at Pizza Hut",
  "start": "2024-01-19T12:30:00",
  "end": "2024-01-19T13:30:00",
  "location": "Pizza Hut",
  "description": null,
  "valid": true,
  "error": null,
  "reasoning": "Extracted venue as location, Friday date, 12:30 time"
}

Input: "Dentist appointment"
Output:
{
  "summary": "Dentist appointment",
  "start": null,
  "end": null,
  "location": null,
  "description": null,
  "valid": false,
  "error": "Missing date/time - when is the appointment?",
  "reasoning": "Clear intent but no temporal information provided"
}

EXAMPLES (POLISH):

Input: "Spotkanie z Janem jutro o 15"
Output:
{
  "summary": "Spotkanie z Janem",
  "start": "2024-01-16T15:00:00",
  "end": "2024-01-16T16:00:00",
  "location": null,
  "description": null,
  "valid": true,
  "error": null,
  "reasoning": "Wyodrębniono tytuł, datę (jutro) i godzinę (15:00)"
}

Input: "fizjoterapia Myśliwska w nastepny czwartek o 15 30"
Current date: "2026-01-29 Thursday"
Output:
{
  "summary": "Fizjoterapia Myśliwska",
  "start": "2026-01-30T15:30:00",
  "end": "2026-01-30T16:30:00",
  "location": "Myśliwska",
  "description": null,
  "valid": true,
  "error": null,
  "reasoning": "Wyodrębniono tytuł, lokalizację (Myśliwska), datę (następny czwartek = 2026-01-30) i godzinę (15:30)"
}

Input: "fizjoterapia myśliwska o 15 30 5 lutego 2026"
Output:
{
  "summary": "Fizjoterapia Myśliwska",
  "start": "2026-02-05T15:30:00",
  "end": "2026-02-05T16:30:00",
  "location": "Myśliwska",
  "description": null,
  "valid": true,
  "error": null,
  "reasoning": "Wyodrębniono tytuł, lokalizację, datę (5 lutego 2026 = 2026-02-05) i godzinę (15:30)"
}

Input: "Obiad u mamy w niedzielę o 14"
Current date: "2024-01-17 Wednesday"
Output:
{
  "summary": "Obiad u mamy",
  "start": "2024-01-21T14:00:00",
  "end": "2024-01-21T15:00:00",
  "location": "U mamy",
  "description": null,
  "valid": true,
  "error": null,
  "reasoning": "Lokalizacja wyodrębniona jako 'u mamy', niedziela jako data (2024-01-21)"
}

Input: "Wizyta lekarska"
Output:
{
  "summary": "Wizyta lekarska",
  "start": null,
  "end": null,
  "location": null,
  "description": null,
  "valid": false,
  "error": "Brak daty/czasu - kiedy ma się odbyć wizyta?",
  "reasoning": "Jasna intencja, ale brak informacji o dacie"
}

${truncationWarning}
USER MESSAGE TO PROCESS:
${textPreview}

Respond with ONLY a JSON object in the format shown above. Do not include any additional text.`;
  },
};
