/**
 * Classification prompts for categorizing content.
 */

export {
  commandClassifierPrompt,
  type CommandCategory,
  type CommandClassifierPromptInput,
  type CommandClassifierPromptDeps,
} from './commandClassifierPrompt.js';

export {
  calendarActionExtractionPrompt,
  type CalendarEventExtractionPromptInput,
  type CalendarEventExtractionPromptDeps,
  type ExtractedCalendarEvent,
} from './calendarActionExtractionPrompt.js';

export {
  linearActionExtractionPrompt,
  type LinearIssueExtractionPromptInput,
  type LinearIssueExtractionPromptDeps,
  type ExtractedLinearIssue,
} from './linearActionExtractionPrompt.js';

export {
  intelligentClassifierPrompt,
  type ClassificationExample,
  type ClassificationCorrection,
  type IntelligentClassifierPromptInput,
  type IntelligentClassifierPromptDeps,
  type CommandExampleSource,
  type TransitionSource,
  toClassificationExample,
  toClassificationCorrection,
} from './intelligentPromptBuilder.js';

export {
  CommandClassificationSchema,
  type CommandType,
  type CommandClassification,
} from './contextSchemas.js';
