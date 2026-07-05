/**
 * Calendar domain public API.
 */

export type {
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  ListEventsInput,
  FreeBusyInput,
  FreeBusySlot,
  EventDateTime,
  EventPerson,
  EventAttendee,
  FailedEvent,
  CreateFailedEventInput,
  FailedEventFilters,
  ProcessedAction,
  CalendarPreview,
  CalendarPreviewStatus,
  CreateCalendarPreviewInput,
  UpdateCalendarPreviewInput,
} from './models.js';

export type { CalendarError, CalendarErrorCode } from './errors.js';

export type {
  GoogleCalendarClient,
  UserServiceClient,
  OAuthTokenResult,
  FailedEventRepository,
  CalendarActionExtractionService,
  ExtractedCalendarEvent,
  ExtractionError,
  ProcessedActionRepository,
  CalendarPreviewRepository,
} from './ports.js';

export type {
  CalendarSchedule,
  CalendarScheduleRun,
  CalendarScheduleStatus,
  CalendarScheduleTaskType,
  ClaimedCalendarSchedule,
  MatrixDeliveryStatus,
  OutboundMatrixMessageResult,
  WhatsAppScheduleClient,
} from './schedules/types.js';
export type {
  CalendarScheduleRepository,
  ClaimDueSchedulesInput,
  MarkRunSentInput,
  MarkRunFailedInput,
} from './schedules/scheduleRepository.js';
export {
  CALENDAR_DAILY_LOOKAHEAD_PROMPT,
  CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE,
} from './schedules/types.js';
export {
  validateScheduleCadence,
  getLocalDateInTimeZone,
  calculateNextScheduleRunAt,
  calculateNextDailyRunAfterLocalDate,
} from './schedules/scheduleTime.js';
export { getDailyLookaheadSchedule } from './schedules/getDailyLookaheadSchedule.js';
export { upsertDailyLookaheadSchedule } from './schedules/upsertDailyLookaheadSchedule.js';
export { runDueSchedules } from './schedules/runDueSchedules.js';

export {
  listEvents,
  type ListEventsRequest,
  type ListEventsDeps,
} from './useCases/listEvents.js';
export {
  getEvent,
  type GetEventRequest,
  type GetEventDeps,
} from './useCases/getEvent.js';
export {
  createEvent,
  type CreateEventRequest,
  type CreateEventDeps,
} from './useCases/createEvent.js';
export {
  updateEvent,
  type UpdateEventRequest,
  type UpdateEventDeps,
} from './useCases/updateEvent.js';
export {
  deleteEvent,
  type DeleteEventRequest,
  type DeleteEventDeps,
} from './useCases/deleteEvent.js';
export {
  getFreeBusy,
  type GetFreeBusyRequest,
  type GetFreeBusyDeps,
} from './useCases/getFreeBusy.js';
export {
  processCalendarAction,
  type ProcessCalendarActionRequest,
  type ProcessCalendarActionDeps,
  type ProcessCalendarActionResponse,
} from './useCases/processCalendarAction.js';
export {
  generateCalendarPreview,
  type GenerateCalendarPreviewRequest,
  type GenerateCalendarPreviewDeps,
  type GenerateCalendarPreviewResponse,
} from './useCases/generateCalendarPreview.js';
