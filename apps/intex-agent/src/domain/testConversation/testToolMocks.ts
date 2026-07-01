import type {
  AddUserPreferenceToolArgs,
  CreateCalendarEventToolArgs,
  CreateCodeTaskToolArgs,
  CreateLinkToolArgs,
  CreateNoteToolArgs,
  CreateResearchToolArgs,
  DeleteUserPreferenceToolArgs,
  IntexAgentToolExecutor,
  QueryCalendarEventsToolArgs,
  SaveExternalToolArgs,
  UpdateUserPreferenceToolArgs,
} from '../agent/toolDefinitions.js';
import type { WhatsAppReplyPublisher } from '../messages/handleIncomingMessage.js';
import type { IntexAgentToolName } from '../sessions/types.js';
import { sanitizeRecord } from './testConversationSanitizer.js';
import type {
  CapturedAssistantReply,
  CapturedToolCall,
  TestToolMocks,
} from './testConversationTypes.js';

export interface CreateTestToolExecutorInput {
  mocks?: TestToolMocks | undefined;
  calls: CapturedToolCall[];
}

export function createTestToolExecutor(input: CreateTestToolExecutorInput): IntexAgentToolExecutor {
  function execute(
    toolName: IntexAgentToolName,
    args: Record<string, unknown>,
    defaultResult: Record<string, unknown>
  ): Promise<string> {
    const mock = input.mocks?.[toolName];
    const argsSummary = summarizeArgs(toolName, args);
    if (mock?.mode === 'failure') {
      input.calls.push({ toolName, status: 'failed', argsSummary, error: mock.message });
      return Promise.reject(new Error(mock.message));
    }

    const result = mock?.mode === 'success' ? mock.result : defaultResult;
    input.calls.push({
      toolName,
      status: 'completed',
      argsSummary,
      resultSummary: summarizeResult(toolName, result),
    });
    return Promise.resolve(JSON.stringify(result));
  }

  return {
    async createNote(args: CreateNoteToolArgs): Promise<string> {
      return await execute('create_note', { ...args }, {
        status: 'completed',
        message: 'Mock note created',
        resourceUrl: '/#/notes/mock-note',
      });
    },
    async createCalendarEvent(args: CreateCalendarEventToolArgs): Promise<string> {
      return await execute('create_calendar_event', { ...args }, {
        status: 'completed',
        eventId: 'mock-calendar-event',
        summary: args.summary,
        htmlLink: 'https://calendar.google.com/calendar/event?eid=mock',
      });
    },
    async queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string> {
      return await execute('query_calendar_events', { ...args }, {
        status: 'completed',
        mode: args.mode,
        count: 0,
        events: [],
      });
    },
    async createResearch(args: CreateResearchToolArgs): Promise<string> {
      return await execute('create_research', { ...args }, {
        status: 'completed',
        message: 'Mock research draft created',
        resourceUrl: '/#/research/mock-research',
      });
    },
    async createLink(args: CreateLinkToolArgs): Promise<string> {
      return await execute('create_link', { ...args }, {
        status: 'completed',
        bookmarkId: 'mock-bookmark',
        resourceUrl: '/#/bookmarks/mock-bookmark',
        url: args.url,
      });
    },
    async createCodeTask(args: CreateCodeTaskToolArgs): Promise<string> {
      return await execute('create_code_task', { ...args }, {
        status: 'completed',
        codeTaskId: 'task_mock',
        resourceUrl: '/#/code-tasks/task_mock',
      });
    },
    async saveExternal(args: SaveExternalToolArgs): Promise<string> {
      return await execute('save_external', { ...args }, {
        status: 'completed',
        message: 'Mock external save completed',
      });
    },
    async getUserPreferences(): Promise<string> {
      return await execute('get_user_preferences', {}, {
        status: 'completed',
        currentVersion: 0,
      });
    },
    async addUserPreference(args: AddUserPreferenceToolArgs): Promise<string> {
      return await execute('add_user_preference', { ...args }, {
        status: 'completed',
        currentVersion: args.expectedVersion + 1,
        changedItemId: 'pref_mock',
      });
    },
    async updateUserPreference(args: UpdateUserPreferenceToolArgs): Promise<string> {
      return await execute('update_user_preference', { ...args }, {
        status: 'completed',
        currentVersion: args.expectedVersion + 1,
        changedItemId: args.itemId,
      });
    },
    async deleteUserPreference(args: DeleteUserPreferenceToolArgs): Promise<string> {
      return await execute('delete_user_preference', { ...args }, {
        status: 'completed',
        currentVersion: args.expectedVersion + 1,
        changedItemId: args.itemId,
      });
    },
  };
}

export function createCapturedReplyPublisher(
  replies: CapturedAssistantReply[]
): WhatsAppReplyPublisher {
  return {
    publishReply(input): Promise<void> {
      replies.push({
        userId: input.userId,
        message: input.message,
        replyToMessageId: input.replyToMessageId,
        correlationId: input.correlationId,
        ...(input.ctaUrl !== undefined ? { ctaUrl: input.ctaUrl } : {}),
        ...(input.buttons !== undefined ? { buttons: input.buttons } : {}),
      });
      return Promise.resolve();
    },
  };
}

function summarizeArgs(
  toolName: IntexAgentToolName,
  args: Record<string, unknown>
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (toolName === 'query_calendar_events') {
    copyString(args, summary, 'mode');
    copyString(args, summary, 'timeMin');
    copyString(args, summary, 'timeMax');
    copyNumber(args, summary, 'maxResults');
    copyStringLength(args, summary, 'query');
    copyPresence(args, summary, 'calendarId');
    return sanitizeRecord(summary);
  }

  if (toolName === 'create_calendar_event') {
    copyStringLength(args, summary, 'summary');
    copyString(args, summary, 'start');
    copyString(args, summary, 'end');
    copyString(args, summary, 'timeZone');
    copyStringLength(args, summary, 'location');
    copyStringLength(args, summary, 'description');
    copyArrayCount(args, summary, 'attendees');
    return sanitizeRecord(summary);
  }

  if (toolName === 'create_note') {
    copyStringLength(args, summary, 'content');
    copyStringLength(args, summary, 'title');
    copyArrayCount(args, summary, 'tags');
    copyArrayCount(args, summary, 'sourceMessageIds');
    return sanitizeRecord(summary);
  }

  if (toolName === 'create_research') {
    copyStringLength(args, summary, 'title');
    copyStringLength(args, summary, 'prompt');
    copyStringLength(args, summary, 'originalMessage');
    copyArrayCount(args, summary, 'sourceMessageIds');
    return sanitizeRecord(summary);
  }

  if (toolName === 'create_link') {
    copyPresence(args, summary, 'url');
    copyStringLength(args, summary, 'title');
    copyStringLength(args, summary, 'description');
    copyArrayCount(args, summary, 'tags');
    copyArrayCount(args, summary, 'sourceMessageIds');
    return sanitizeRecord(summary);
  }

  if (toolName === 'create_code_task') {
    copyStringLength(args, summary, 'prompt');
    copyString(args, summary, 'workerType');
    copyString(args, summary, 'taskMode');
    copyPresence(args, summary, 'linearIssueId');
    return sanitizeRecord(summary);
  }

  if (toolName === 'save_external') {
    copyStringLength(args, summary, 'message');
    copyPresence(args, summary, 'sourceUrl');
    return sanitizeRecord(summary);
  }

  if (toolName === 'get_user_preferences') {
    return {};
  }

  if (toolName === 'add_user_preference') {
    copyStringLength(args, summary, 'text');
    copyNumber(args, summary, 'expectedVersion');
    return sanitizeRecord(summary);
  }

  copyPresence(args, summary, 'itemId');
  copyStringLength(args, summary, 'text');
  copyNumber(args, summary, 'expectedVersion');
  return sanitizeRecord(summary);
}

function summarizeResult(
  _toolName: IntexAgentToolName,
  result: Record<string, unknown>
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of ['status', 'mode', 'count', 'currentVersion']) {
    const value = result[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
    }
  }
  for (const key of ['eventId', 'bookmarkId', 'codeTaskId', 'changedItemId']) {
    copyPresence(result, summary, key);
  }
  for (const key of ['resourceUrl', 'htmlLink', 'url', 'sourceUrl']) {
    copyPresence(result, summary, key);
  }
  return sanitizeRecord(summary);
}

function copyString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (typeof value === 'string') {
    target[key] = value;
  }
}

function copyNumber(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (typeof value === 'number') {
    target[key] = value;
  }
}

function copyStringLength(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (typeof value === 'string') {
    target[`${key}Length`] = value.length;
  }
}

function copyArrayCount(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (Array.isArray(value)) {
    target[`${key}Count`] = value.length;
  }
}

function copyPresence(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  if (source[key] !== undefined) {
    target[`has${key.charAt(0).toUpperCase()}${key.slice(1)}`] = true;
  }
}
