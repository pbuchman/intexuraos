import { getErrorMessage, type Result, type ServiceFeedback } from '@intexuraos/common-core';
import type {
  CreateBookmarkError,
  CreateBookmarkRequest,
  CreateBookmarkResponse,
  CreateCalendarEventRequest,
  CreateCodeTaskRequest,
  CreateNoteRequest,
  CreateResearchDraftRequest,
  CreatedCalendarEvent,
  SubmitTaskError,
  SubmitTaskResponse,
} from '@intexuraos/internal-clients';
import type {
  CreateCalendarEventToolArgs,
  CreateCodeTaskToolArgs,
  CreateLinkToolArgs,
  IntexAgentToolExecutor,
} from './toolDefinitions.js';

export interface NotesToolClient {
  createNote(input: CreateNoteRequest): Promise<Result<ServiceFeedback>>;
}

export interface CalendarToolClient {
  createEvent(input: CreateCalendarEventRequest): Promise<Result<CreatedCalendarEvent>>;
}

export interface ResearchToolClient {
  createDraft(input: CreateResearchDraftRequest): Promise<Result<ServiceFeedback>>;
}

export interface BookmarksToolClient {
  createBookmark(
    input: CreateBookmarkRequest
  ): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>>;
}

export interface CodeTaskToolClient {
  createCodeTask(
    input: CreateCodeTaskRequest
  ): Promise<Result<SubmitTaskResponse, SubmitTaskError>>;
}

export interface CreateIntexAgentToolExecutorDeps {
  userId: string;
  messageId: string;
  notesClient: NotesToolClient;
  calendarClient: CalendarToolClient;
  researchClient: ResearchToolClient;
  bookmarksClient: BookmarksToolClient;
  codeClient: CodeTaskToolClient;
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

    async createResearch(args): Promise<string> {
      const result = await deps.researchClient.createDraft({
        userId: deps.userId,
        title: args.title,
        prompt: args.prompt,
        originalMessage: args.originalMessage ?? args.prompt,
      });

      if (!result.ok) {
        throw new Error(`Failed to create research: ${getErrorMessage(result.error)}`);
      }

      const feedback = result.value;
      if (feedback.status === 'failed') {
        throw new Error(`Failed to create research: ${feedback.message}`);
      }

      return JSON.stringify({
        status: feedback.status,
        message: feedback.message,
        ...(feedback.resourceUrl !== undefined ? { resourceUrl: feedback.resourceUrl } : {}),
      });
    },

    async createLink(args): Promise<string> {
      const result = await deps.bookmarksClient.createBookmark(toBookmarkInput(args, deps));

      if (!result.ok) {
        throw new Error(`Failed to create link: ${getErrorMessage(result.error)}`);
      }

      const bookmark = result.value;
      return JSON.stringify({
        status: 'completed',
        bookmarkId: bookmark.id,
        url: bookmark.url,
        ...(bookmark.title !== null ? { title: bookmark.title } : {}),
      });
    },

    async createCodeTask(args): Promise<string> {
      const result = await deps.codeClient.createCodeTask(toCodeTaskInput(args, deps.userId));

      if (!result.ok) {
        throw new Error(`Failed to create code task: ${getErrorMessage(result.error)}`);
      }

      const task = result.value;
      return JSON.stringify({
        status: 'completed',
        codeTaskId: task.codeTaskId,
        resourceUrl: task.resourceUrl,
      });
    },
  };
}

function toBookmarkInput(
  args: CreateLinkToolArgs,
  deps: Pick<CreateIntexAgentToolExecutorDeps, 'userId' | 'messageId'>
): CreateBookmarkRequest {
  return {
    userId: deps.userId,
    url: args.url,
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.description !== undefined ? { description: args.description } : {}),
    tags: args.tags ?? [],
    source: 'whatsapp',
    sourceId: args.sourceMessageIds?.[0] ?? deps.messageId,
  };
}

function toCodeTaskInput(args: CreateCodeTaskToolArgs, userId: string): CreateCodeTaskRequest {
  return {
    userId,
    prompt: args.prompt,
    ...(args.workerType !== undefined ? { workerType: args.workerType } : {}),
    ...(args.linearIssueId !== undefined ? { linearIssueId: args.linearIssueId } : {}),
    taskMode: args.taskMode ?? 'planning',
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
