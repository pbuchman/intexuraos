import { getErrorMessage, type Result, type ServiceFeedback } from '@intexuraos/common-core';
import type {
  CreateCalendarEventRequest,
  CreateNoteRequest,
  CreatedCalendarEvent,
} from '@intexuraos/internal-clients';
import type {
  CreateCalendarEventToolArgs,
  IntexAgentToolExecutor,
} from './toolDefinitions.js';

export interface NotesToolClient {
  createNote(input: CreateNoteRequest): Promise<Result<ServiceFeedback>>;
}

export interface CalendarToolClient {
  createEvent(input: CreateCalendarEventRequest): Promise<Result<CreatedCalendarEvent>>;
}

export interface CreateIntexAgentToolExecutorDeps {
  userId: string;
  messageId: string;
  notesClient: NotesToolClient;
  calendarClient: CalendarToolClient;
}

export function createIntexAgentToolExecutor(
  deps: CreateIntexAgentToolExecutorDeps
): IntexAgentToolExecutor {
  return {
    async createNote(args): Promise<string> {
      const result = await deps.notesClient.createNote({
        userId: deps.userId,
        title: args.title ?? deriveNoteTitle(args.content),
        content: args.content,
        tags: args.tags ?? [],
        source: 'whatsapp',
        sourceId: args.sourceMessageIds?.[0] ?? deps.messageId,
      });

      if (!result.ok) {
        throw new Error(`Failed to create note: ${getErrorMessage(result.error)}`);
      }

      if (result.value.status === 'failed') { // @allow-result-access -- guarded by !result.ok check above
        throw new Error(`Failed to create note: ${result.value.message}`); // @allow-result-access -- guarded by !result.ok check above
      }

      return JSON.stringify({
        status: result.value.status, // @allow-result-access -- guarded by !result.ok check above
        message: result.value.message, // @allow-result-access -- guarded by !result.ok check above
        ...(result.value.resourceUrl !== undefined ? { resourceUrl: result.value.resourceUrl } : {}), // @allow-result-access -- guarded by !result.ok check above
      });
    },

    async createCalendarEvent(args): Promise<string> {
      const result = await deps.calendarClient.createEvent({
        userId: deps.userId,
        event: toCalendarEventInput(args),
      });

      if (!result.ok) {
        throw new Error(`Failed to create calendar event: ${getErrorMessage(result.error)}`);
      }

      return JSON.stringify({
        status: 'completed',
        eventId: result.value.id, // @allow-result-access -- guarded by !result.ok check above
        summary: result.value.summary, // @allow-result-access -- guarded by !result.ok check above
        ...(result.value.htmlLink !== undefined ? { htmlLink: result.value.htmlLink } : {}), // @allow-result-access -- guarded by !result.ok check above
      });
    },
  };
}

function toCalendarEventInput(
  args: CreateCalendarEventToolArgs
): CreateCalendarEventRequest['event'] {
  return {
    summary: args.summary,
    start: toEventDateTime(args.start, args.timeZone),
    end: toEventDateTime(args.end, args.timeZone),
    ...(args.location !== undefined ? { location: args.location } : {}),
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.attendees !== undefined
      ? { attendees: args.attendees.map((email) => ({ email })) }
      : {}),
  };
}

function toEventDateTime(
  dateTime: string,
  timeZone: string | undefined
): CreateCalendarEventRequest['event']['start'] {
  return {
    dateTime,
    ...(timeZone !== undefined ? { timeZone } : {}),
  };
}

function deriveNoteTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 80) {
    return normalized.length === 0 ? 'WhatsApp note' : normalized;
  }
  return `${normalized.slice(0, 77)}...`;
}
