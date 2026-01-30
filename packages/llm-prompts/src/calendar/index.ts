/**
 * Calendar domain exports from llm-prompts package.
 */

export {
  CalendarEventSchema,
  type CalendarEvent,
  type ExtractedCalendarEvent,
} from './contextSchemas.js';

export {
  calendarExtractionRepairPrompt,
  buildCalendarExtractionRepairPrompt,
  type CalendarExtractionRepairPromptInput,
  type CalendarExtractionRepairPromptDeps,
} from './repairPrompt.js';

export {
  calendarActionExtractionPrompt,
  type CalendarEventExtractionPromptInput,
  type CalendarEventExtractionPromptDeps,
} from './calendarActionExtractionPrompt.js';
