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
