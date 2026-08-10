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
  UpdateCalendarEventToolArgs,
  UpdateUserPreferenceToolArgs,
} from '../agent/toolDefinitions.js';
import type { WhatsAppReplyPublisher } from '../messages/handleIncomingMessage.js';
import type { IntexAgentToolName } from '../sessions/types.js';
import {
  normalizePromptPreferenceText,
  renderPromptPreferenceBlock,
} from '../preferences/promptPreferences.js';
import { sanitizeRecord, summarizeArgs } from './testConversationSanitizer.js';
import type {
  CapturedAssistantReply,
  CapturedToolCall,
  TestToolMocks,
} from './testConversationTypes.js';
import { TEST_CONVERSATION_TOOL_FAILURE_CODE } from './testConversationTypes.js';

export interface CreateTestToolExecutorInput {
  mocks?: TestToolMocks | undefined;
  calls: CapturedToolCall[];
}

const MOCK_PREFERENCE_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const MOCK_PREFERENCE_ITEM_ID = 'pref_mock';

export function createTestToolExecutor(input: CreateTestToolExecutorInput): IntexAgentToolExecutor {
  function execute(
    toolName: IntexAgentToolName,
    args: Record<string, unknown>,
    defaultResult: Record<string, unknown>
  ): Promise<string> {
    const mock = input.mocks?.[toolName];
    const argsSummary = summarizeArgs(toolName, args);
    if (mock?.mode === 'failure') {
      input.calls.push({
        toolName,
        status: 'failed',
        argsSummary,
        error: TEST_CONVERSATION_TOOL_FAILURE_CODE,
      });
      return Promise.reject(new Error(TEST_CONVERSATION_TOOL_FAILURE_CODE));
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
    async updateCalendarEvent(args: UpdateCalendarEventToolArgs): Promise<string> {
      requireCalendarUpdateSnapshot(args);
      return await execute('update_calendar_event', { ...args }, {
        status: 'completed',
        eventId: args.eventId,
        summary: args.eventSummary,
        attendeesAdded: args.attendeesToAdd,
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
      const currentVersion = args.expectedVersion + 1;
      return await execute('add_user_preference', { ...args }, {
        status: 'completed',
        currentVersion,
        changedItemId: MOCK_PREFERENCE_ITEM_ID,
        promptBlock: renderMockPreferenceBlock(
          currentVersion,
          MOCK_PREFERENCE_ITEM_ID,
          args.text
        ),
      });
    },
    async updateUserPreference(args: UpdateUserPreferenceToolArgs): Promise<string> {
      const currentVersion = args.expectedVersion + 1;
      return await execute('update_user_preference', { ...args }, {
        status: 'completed',
        currentVersion,
        changedItemId: args.itemId,
        promptBlock: renderMockPreferenceBlock(currentVersion, args.itemId, args.text),
      });
    },
    async deleteUserPreference(args: DeleteUserPreferenceToolArgs): Promise<string> {
      return await execute('delete_user_preference', { ...args }, {
        status: 'completed',
        currentVersion: args.expectedVersion + 1,
        changedItemId: args.itemId,
        promptBlock: '',
      });
    },
  };
}

function requireCalendarUpdateSnapshot(args: UpdateCalendarEventToolArgs): void {
  if (
    args.calendarId === undefined ||
    args.calendarId.trim() === '' ||
    args.expectedEtag === undefined ||
    args.expectedEtag.trim() === '' ||
    args.eventStart === undefined ||
    args.eventEnd === undefined
  ) {
    throw new Error('Calendar event snapshot is missing or incomplete');
  }
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

function copyPresence(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  if (source[key] !== undefined) {
    target[`has${key.charAt(0).toUpperCase()}${key.slice(1)}`] = true;
  }
}

function renderMockPreferenceBlock(currentVersion: number, itemId: string, text: string): string {
  const normalizedText = normalizePromptPreferenceText(text);
  return renderPromptPreferenceBlock(currentVersion, [
    {
      id: itemId,
      text: normalizedText,
      createdAt: MOCK_PREFERENCE_TIMESTAMP,
      updatedAt: MOCK_PREFERENCE_TIMESTAMP,
    },
  ]);
}
