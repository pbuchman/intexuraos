import type { ToolDefinition } from '@intexuraos/llm-contract';
import {
  calendarEventDateTimeSchema,
  calendarListEventsRequestSchema,
  calendarUpdateEventAttendeesRequestSchema,
} from '@intexuraos/http-contracts';

export interface CreateNoteToolArgs {
  content: string;
  title?: string;
  tags?: string[];
  sourceMessageIds?: string[];
}

export interface CreateCalendarEventToolArgs {
  summary: string;
  start: string;
  end: string;
  timeZone?: string;
  location?: string;
  description?: string;
  attendees?: string[];
}

export interface QueryCalendarEventsToolArgs {
  mode: 'list' | 'count';
  timeMin: string;
  timeMax: string;
  query?: string;
  calendarId?: string;
  maxResults?: number;
}

export interface UpdateCalendarEventToolArgs {
  eventId: string;
  eventSummary: string;
  attendeesToAdd: string[];
  calendarId?: string;
  expectedEtag?: string;
  eventStart?: CalendarEventDateTimeSnapshot;
  eventEnd?: CalendarEventDateTimeSnapshot;
}

export interface CalendarEventDateTimeSnapshot {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface CreateResearchToolArgs {
  title: string;
  prompt: string;
  originalMessage?: string;
  sourceMessageIds?: string[];
}

export interface CreateLinkToolArgs {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  sourceMessageIds?: string[];
}

export interface CreateCodeTaskToolArgs {
  prompt: string;
  workerType?: string;
  linearIssueId?: string;
  taskMode: 'planning' | 'execution';
}

export interface SaveExternalToolArgs {
  message: string;
  sourceUrl?: string;
}

export interface AddUserPreferenceToolArgs {
  text: string;
  expectedVersion: number;
}

export interface UpdateUserPreferenceToolArgs {
  itemId: string;
  text: string;
  expectedVersion: number;
}

export interface DeleteUserPreferenceToolArgs {
  itemId: string;
  expectedVersion: number;
}

const EXPLICIT_CODE_TASK_WORKER_TYPES = ['codex', 'codex-xhigh', 'openrouter-free'] as const;

interface ToolDescriptionParts {
  purpose: string;
  useFor: string;
  doNotUseFor: string;
  requiredInput: string;
  boundary: string;
  examples: string;
  result: string;
  errors: string;
}

function toolDescription(parts: ToolDescriptionParts): string {
  return [
    `Purpose: ${parts.purpose}`,
    `Use for: ${parts.useFor}`,
    `Do not use for: ${parts.doNotUseFor}`,
    `Required input: ${parts.requiredInput}`,
    `Boundary: ${parts.boundary}`,
    `Examples: ${parts.examples}`,
    `Result: ${parts.result}`,
    `Errors: ${parts.errors}`,
  ].join('\n');
}

export interface IntexAgentToolExecutor {
  createNote(args: CreateNoteToolArgs): Promise<string>;
  createCalendarEvent(args: CreateCalendarEventToolArgs): Promise<string>;
  queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string>;
  updateCalendarEvent(args: UpdateCalendarEventToolArgs): Promise<string>;
  createResearch(args: CreateResearchToolArgs): Promise<string>;
  createLink(args: CreateLinkToolArgs): Promise<string>;
  createCodeTask(args: CreateCodeTaskToolArgs): Promise<string>;
  saveExternal(args: SaveExternalToolArgs): Promise<string>;
  getUserPreferences(): Promise<string>;
  addUserPreference(args: AddUserPreferenceToolArgs): Promise<string>;
  updateUserPreference(args: UpdateUserPreferenceToolArgs): Promise<string>;
  deleteUserPreference(args: DeleteUserPreferenceToolArgs): Promise<string>;
}

export function createIntexAgentToolDefinitions(executor: IntexAgentToolExecutor): ToolDefinition[] {
  return [
    {
      name: 'create_note',
      description: toolDescription({
        purpose: 'Create a user note containing factual content the user explicitly wants saved as a note.',
        useFor: '"save a note: gate code is 4938", "write this down as a note", "zapisz notatke".',
        doNotUseFor:
          '"what did I say earlier?", "draft a note but do not save", greetings, smalltalk, durable assistant behavior such as "remember to reply shorter", or unsupported external tasks.',
        requiredInput: 'content is required. title, tags, and sourceMessageIds are optional.',
        boundary:
          'If the user asks for proposed note text without saving, answer in conversation. If the user wants durable assistant style/language/tone behavior, use preference tools instead of a note.',
        examples:
          'Positive: "Create a note: office PIN is 1357." Negative: "Remember that I prefer concise replies" unless the user asks for a note.',
        result: 'Returns a completed note result with a message and optional resource URL.',
        errors: 'Validation covers missing content; downstream failures should be surfaced as tool failures.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: {
          content: {
            type: 'string',
            description: 'The note body to save. Preserve the important user details.',
          },
          title: {
            type: 'string',
            description: 'Optional short note title.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional user-relevant tags.',
          },
          sourceMessageIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional WhatsApp message IDs that produced this note.',
          },
        },
      },
      run: async (args: Record<string, unknown>) => await executor.createNote(toCreateNoteArgs(args)),
    },
    {
      name: 'create_calendar_event',
      description: toolDescription({
        purpose: 'Create a new calendar event, appointment, meeting, scheduled block, or calendar item.',
        useFor: '"Schedule dentist tomorrow 09:00-09:30", "add a calendar event for the planning meeting".',
        doNotUseFor:
          '"Am I free tomorrow?", "What meetings do I have?", "Move my dentist appointment", "Cancel tomorrow\'s meeting", or read-only calendar questions.',
        requiredInput:
          'summary, start, and end are required. Summary must be a concise user-grounded event title, never analysis or a clarification message. Use ISO/provider-accepted date-time strings and include timeZone when known.',
        boundary:
          'If the title, date, or start is missing or ambiguous, this call is draft-only and the user-visible outcome must remain a clarification. An explicit duration is sufficient to derive end. When both end and duration are absent, use a visible 60-minute default in the same final confirmation without a separate acceptance turn. Never put analysis or uncertainty into summary. Availability-first requests require query_calendar_events first.',
        examples:
          'Positive: "Schedule dentist tomorrow 09:00-09:30." Negative: "Am I free Friday afternoon?"',
        result: 'Returns status, event ID, summary, and optional calendar link.',
        errors: 'Validation covers invalid date-time or attendees; permission/configuration covers calendar access problems.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'start', 'end'],
        properties: {
          summary: {
            type: 'string',
            description: 'Calendar event title.',
          },
          start: {
            type: 'string',
            description: 'Event start as an ISO date-time or provider-accepted date-time.',
          },
          end: {
            type: 'string',
            description: 'Event end as an ISO date-time or provider-accepted date-time.',
          },
          timeZone: {
            type: 'string',
            description: 'IANA timezone when known.',
          },
          location: {
            type: 'string',
            description: 'Optional event location.',
          },
          description: {
            type: 'string',
            description: 'Optional event description.',
          },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional attendee email addresses.',
          },
        },
      },
      run: async (args: Record<string, unknown>) =>
        await executor.createCalendarEvent(toCreateCalendarEventArgs(args)),
    },
    {
      name: 'query_calendar_events',
      description: toolDescription({
        purpose: 'read-only calendar query tool for existing events.',
        useFor:
          '"Show tomorrow\'s events", "How many dentist visits last month?", "Am I free Friday afternoon?", and the required lookup before update_calendar_event.',
        doNotUseFor:
          'performing the mutation itself, creating, canceling, deleting, or rescheduling calendar events.',
        requiredInput:
          'mode, timeMin, and timeMax are required. Use mode list for event details/availability and count for count-only questions.',
        boundary:
          'This tool never mutates calendar data. It may identify the exact event snapshot before update_calendar_event. Empty event arrays are successful "no events found" results.',
        examples:
          'Positive: "List my meetings tomorrow." Negative: "Schedule a meeting tomorrow."',
        result:
          'Returns status, mode, count, timeMin, timeMax, optional query, optional events for list mode, and optional truncated.',
        errors: 'Validation covers invalid time ranges; permission/configuration covers calendar access problems.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'timeMin', 'timeMax'],
        properties: {
          mode: {
            type: 'string',
            enum: ['list', 'count'],
            description: 'Use list to return event details; use count to return only the count.',
          },
          timeMin: {
            type: 'string',
            description: 'Inclusive lower calendar query bound as an ISO date-time.',
          },
          timeMax: {
            type: 'string',
            description: 'Exclusive upper calendar query bound as an ISO date-time.',
          },
          query: {
            type: 'string',
            description: 'Optional search text for matching event summaries or provider search.',
          },
          calendarId: {
            type: 'string',
            description: 'Optional calendar identifier. Omit to use the default calendar.',
          },
          maxResults: {
            type: 'integer',
            minimum: 1,
            maximum: 2500,
            description: 'Optional positive integer maximum number of events to query.',
          },
        },
      },
      run: async (args: Record<string, unknown>) =>
        await executor.queryCalendarEvents(toQueryCalendarEventsArgs(args)),
    },
    {
      name: 'update_calendar_event',
      description: toolDescription({
        purpose: 'Add one or more attendees to one existing calendar event.',
        useFor:
          '"Invite Patryk to the existing Bagrowa event", "add anna@example.com to tomorrow\'s planning meeting".',
        doNotUseFor:
          'creating a new event, changing its title, time, description, or location, deleting it, or updating an event that was not identified from calendar results.',
        requiredInput:
          'eventId, eventSummary, and a non-empty attendeesToAdd email list are required. calendarId is optional.',
        boundary:
          'Use query_calendar_events first to identify exactly one existing event and reuse its calendarId when specified. If no event or multiple events match, ask a targeted clarification. This mutating action always requires confirmation and preserves every other event detail.',
        examples:
          'Positive: after one query result, add pat@example.com to that event. Negative: "Create dinner with Pat tomorrow".',
        result: 'Returns status, event ID, summary, added attendees, and an optional calendar link.',
        errors:
          'Validation covers a missing event ID or empty attendee list; permission/configuration covers calendar access problems.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['eventId', 'eventSummary', 'attendeesToAdd'],
        properties: {
          eventId: {
            type: 'string',
            description: 'Exact event ID returned by query_calendar_events.',
          },
          eventSummary: {
            type: 'string',
            description: 'Exact event summary returned by query_calendar_events for confirmation.',
          },
          attendeesToAdd: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', format: 'email' },
            description: 'Attendee email addresses to add without replacing existing attendees.',
          },
          calendarId: {
            type: 'string',
            description: 'Optional calendar identifier. Omit to use the default calendar.',
          },
        },
      },
      run: async (args: Record<string, unknown>) =>
        await executor.updateCalendarEvent(toUpdateCalendarEventArgs(args)),
    },
    {
      name: 'create_research',
      description: toolDescription({
        purpose: 'Create an external research draft or research job, not an immediate answer.',
        useFor: '"Create a research draft about GPU pricing", "prepare research from this URL".',
        doNotUseFor:
          '"Explain GPU pricing to me", general explanations, "how does this work", personal IntexuraOS data lookup, calendar/notes/bookmarks/code task search, or saving a URL as a bookmark.',
        requiredInput: 'title and prompt are required. originalMessage and sourceMessageIds are optional.',
        boundary:
          'If a URL appears inside an explicit research-draft request, use this tool instead of create_link. Arbitrary URL summarization is unsupported unless the user asks for a research draft.',
        examples:
          'Positive: "Create a research draft about GPU pricing." Negative: "Summarize this URL now."',
        result: 'Returns a completed draft result with message and optional resource URL.',
        errors: 'Downstream draft creation failures should preserve whether retry is useful.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'prompt'],
        properties: {
          title: {
            type: 'string',
            description: 'Short research title.',
          },
          prompt: {
            type: 'string',
            description: 'Detailed research request to investigate.',
          },
          originalMessage: {
            type: 'string',
            description: 'Original user message when available.',
          },
          sourceMessageIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional WhatsApp message IDs that produced this research draft.',
          },
        },
      },
      run: async (args: Record<string, unknown>) =>
        await executor.createResearch(toCreateResearchArgs(args)),
    },
    {
      name: 'create_link',
      description: toolDescription({
        purpose: 'Save a bookmark/link.',
        useFor: 'a bare URL, "bookmark this", "save this link", or "add this URL as a bookmark".',
        doNotUseFor:
          '"create a research draft from this URL", "save externally this URL", "create a calendar event with this URL", or arbitrary URL reading/summarization.',
        requiredInput: 'url is required. title, description, tags, and sourceMessageIds are optional.',
        boundary:
          'If an explicit alternate resource intent exists, use that resource tool instead. Ignore keywords inside URL paths or domains.',
        examples:
          'Positive: "https://example.com" as a bare URL. Negative: "Open this URL and summarize it."',
        result: 'Returns status, bookmark ID, resource URL, original URL, and optional title.',
        errors:
          'Validation covers malformed URLs. Never fetch, read, title, summarize, or inspect the URL; title and description must come from user text only.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            description: 'The URL to save as a bookmark.',
          },
          title: {
            type: 'string',
            description: 'Optional bookmark title.',
          },
          description: {
            type: 'string',
            description: 'Optional bookmark description.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional bookmark tags.',
          },
          sourceMessageIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional WhatsApp message IDs that produced this bookmark.',
          },
        },
      },
      run: async (args: Record<string, unknown>) => await executor.createLink(toCreateLinkArgs(args)),
    },
    {
      name: 'create_code_task',
      description: toolDescription({
        purpose: 'Create an IntexuraOS code task.',
        useFor:
          '"Create a code task to investigate auth bug", "Create code task execution for Linear issue INT-123".',
        doNotUseFor:
          '"How do HTTP requests work?", "Can you code this right here?", "What parameters do code tasks need?", or general programming explanations.',
        requiredInput:
          'prompt is required. workerType, linearIssueId, and taskMode are optional. workerType is only codex, codex-xhigh, or openrouter-free.',
        boundary:
          'planning mode is default. Use execution mode only when explicitly requested or when the user says the task is in execution stage. Set linearIssueId only when the user explicitly associates a supplied identifier with a Linear issue or ticket. An arbitrary opaque identifier, tracking marker, or evaluation marker is not enough; keep it in the task prompt and omit linearIssueId.',
        examples:
          'Positive: "Create a code task execution for Linear issue INT-123." Negative: "Explain React hooks."',
        result: 'Returns status, code task ID, and resource URL.',
        errors: 'Validation covers missing prompt, invalid worker type, invalid task mode, or invalid Linear issue ID.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description: 'Code task request.',
          },
          workerType: {
            type: 'string',
            enum: [...EXPLICIT_CODE_TASK_WORKER_TYPES],
            description:
              'Optional worker type. Set only when explicitly requested by the user. Available choices: Codex (codex), Codex extra high (codex-xhigh), OpenRouter Free (openrouter-free).',
          },
          linearIssueId: {
            type: 'string',
            description:
              'Optional Linear issue ID to associate with the task. Set only when the user explicitly associates the supplied identifier with a Linear issue or ticket. An arbitrary opaque identifier, tracking marker, or evaluation marker is not enough; keep it in the task prompt and omit linearIssueId.',
          },
          taskMode: {
            type: 'string',
            enum: ['planning', 'execution'],
            description:
              'Use planning by default. Use execution only when explicitly requested by the user.',
          },
        },
      },
      run: async (args: Record<string, unknown>) =>
        await executor.createCodeTask(toCreateCodeTaskArgs(args)),
    },
    {
      name: 'save_external',
      description: toolDescription({
        purpose: 'Forward/save a message or source URL to the configured external processing destination.',
        useFor:
          '"Save externally this receipt", "save for processing", "zapisz do przetworzenia ten paragon".',
        doNotUseFor:
          'bare URL bookmarks, research drafts from URLs, summarizing/opening/fetching URLs, ordinary notes, or calendar/code tasks.',
        requiredInput:
          'message is required. sourceUrl is optional and must be passed through without fetching or inspecting it.',
        boundary:
          'Current representable inputs are message and optional sourceUrl; do not imply attachment bytes are available unless the pipeline provides a source URL.',
        examples:
          'Positive: "Save externally this receipt." Negative: "Bookmark this URL."',
        result: 'Returns status and downstream user-facing message.',
        errors:
          'External save not configured is configuration; auth/setup failures are permission/configuration; temporary downstream failures are transient. Do not fetch, inspect, summarize, or open sourceUrl.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: {
          message: {
            type: 'string',
            description: 'Raw user caption or pasted text to send to the external system.',
          },
          sourceUrl: {
            type: 'string',
            description:
              'Optional original shared URL or image URL. Pass it through without fetching or inspecting it.',
          },
        },
      },
      run: async (args: Record<string, unknown>) => await executor.saveExternal(toSaveExternalArgs(args)),
    },
    {
      name: 'get_user_preferences',
      description: toolDescription({
        purpose: 'Read the current rendered defined Intex Agent preference block.',
        useFor: '"Show my Intex Agent preferences", "What instructions have I saved for you?"',
        doNotUseFor: '"Reply more briefly", "Use Polish", "What can you do?", or preference mutation.',
        requiredInput: 'No arguments.',
        boundary:
          'Return only the current preference block or the empty-preferences sentence. No full system prompt.',
        examples:
          'Positive: "Show my prompt preferences." Negative: "Be shorter in this answer."',
        result: 'Returns status, currentVersion, and promptBlock. Empty preference state is success.',
        errors: 'Repository failures should be classified; no preferences is not an error.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      run: async () => await executor.getUserPreferences(),
    },
    {
      name: 'add_user_preference',
      description: toolDescription({
        purpose: 'Add one durable Intex Agent preference row.',
        useFor:
          '"Add a preference: reply in Polish unless I ask otherwise", "Remember as an Intex Agent preference: be brief", "Add instruction: use dry irony lightly".',
        doNotUseFor:
          'immediate-only style feedback such as "be shorter" unless the user indicates durability, or factual notes when the user asked to save a note.',
        requiredInput: 'text and expectedVersion are required.',
        boundary:
          'Preference text must be one normalized row. Reject rows that request unsupported tool use, unavailable data access, auth bypass, permission bypass, or unsafe behavior.',
        examples:
          'Positive: "From now on, reply in formal Polish." Negative: "Save a note: I like short replies."',
        result: 'Returns status, currentVersion, rendered promptBlock, and changed item ID.',
        errors: 'Validation covers empty/too-long/control-character rows; stale version is version conflict.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'expectedVersion'],
        properties: {
          text: {
            type: 'string',
            description: 'Exact single preference row text to store.',
          },
          expectedVersion: {
            type: 'integer',
            minimum: 0,
            description: 'Current preference version from the prompt block, or 0 when no block exists.',
          },
        },
      },
      run: async (args: Record<string, unknown>) =>
        await executor.addUserPreference(toAddUserPreferenceArgs(args)),
    },
    {
      name: 'update_user_preference',
      description: toolDescription({
        purpose: 'Update one existing durable Intex Agent preference row.',
        useFor: '"Update pref_abc123 to: use formal Polish".',
        doNotUseFor:
          'vague targets such as "change the tone preference" when multiple rows may match. Do not guess.',
        requiredInput: 'itemId, text, and expectedVersion are required.',
        boundary:
          'Use only when the exact current item id and version are already known. If the target is vague, ask clarification or use get_user_preferences in a separate read-only turn; do not chain get_user_preferences and this mutation in one turn.',
        examples:
          'Positive: "Update pref_abc123 to: be concise." Negative: "Change the tone preference" without a clear row.',
        result: 'Returns status, currentVersion, rendered promptBlock, and changed item ID.',
        errors: 'Unknown item ID, invalid row text, or stale expectedVersion must not be hidden as unsupported.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['itemId', 'text', 'expectedVersion'],
        properties: {
          itemId: {
            type: 'string',
            description: 'Stable current preference item id such as pref_abc123.',
          },
          text: {
            type: 'string',
            description: 'Replacement single preference row text.',
          },
          expectedVersion: {
            type: 'integer',
            minimum: 0,
            description: 'Current preference version from the latest prompt block.',
          },
        },
      },
      run: async (args: Record<string, unknown>) =>
        await executor.updateUserPreference(toUpdateUserPreferenceArgs(args)),
    },
    {
      name: 'delete_user_preference',
      description: toolDescription({
        purpose: 'Delete/remove one current durable Intex Agent preference row.',
        useFor: '"Delete preference pref_abc123".',
        doNotUseFor:
          'immediate style feedback such as "stop being so formal" unless the user explicitly asks to delete a saved preference.',
        requiredInput: 'itemId and expectedVersion are required.',
        boundary:
          'Use only when the exact current item id and version are already known. If the target row is ambiguous, ask clarification or use get_user_preferences in a separate read-only turn; do not chain get_user_preferences and this mutation in one turn.',
        examples:
          'Positive: "Remove pref_abc123." Negative: "stop being so formal" as current-turn feedback.',
        result: 'Returns status, currentVersion, rendered promptBlock, and changed item ID.',
        errors: 'Unknown item ID or stale expectedVersion must not be hidden as unsupported.',
      }),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['itemId', 'expectedVersion'],
        properties: {
          itemId: {
            type: 'string',
            description: 'Stable current preference item id such as pref_abc123.',
          },
          expectedVersion: {
            type: 'integer',
            minimum: 0,
            description: 'Current preference version from the latest prompt block.',
          },
        },
      },
      run: async (args: Record<string, unknown>) =>
        await executor.deleteUserPreference(toDeleteUserPreferenceArgs(args)),
    },
  ];
}

function toCreateNoteArgs(args: Record<string, unknown>): CreateNoteToolArgs {
  const content = requiredString(args, 'content');
  const title = optionalString(args, 'title');
  const tags = optionalStringArray(args, 'tags');
  const sourceMessageIds = optionalStringArray(args, 'sourceMessageIds');

  return {
    content,
    ...(title !== undefined ? { title } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(sourceMessageIds !== undefined ? { sourceMessageIds } : {}),
  };
}

function toCreateCalendarEventArgs(args: Record<string, unknown>): CreateCalendarEventToolArgs {
  const summary = requiredString(args, 'summary');
  const timeZone = optionalString(args, 'timeZone');
  if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
    throw new Error('Tool argument timeZone must be a valid IANA time zone');
  }
  const start = requiredCalendarEventDateTime(args, 'start', timeZone);
  const end = requiredCalendarEventDateTime(args, 'end', timeZone);
  if (start.hasOffset !== end.hasOffset) {
    throw new Error(
      'Tool arguments start and end must both include offsets or both use timeZone'
    );
  }
  if (start.comparisonMs >= end.comparisonMs) {
    throw new Error('Tool argument end must be after start');
  }
  const location = optionalString(args, 'location');
  const description = optionalString(args, 'description');
  const attendees = optionalStringArray(args, 'attendees');

  return {
    summary,
    start: start.value,
    end: end.value,
    ...(timeZone !== undefined ? { timeZone } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(attendees !== undefined ? { attendees } : {}),
  };
}

interface ValidatedCalendarEventDateTime {
  value: string;
  hasOffset: boolean;
  comparisonMs: number;
}

const CALENDAR_EVENT_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/u;

function requiredCalendarEventDateTime(
  args: Record<string, unknown>,
  key: 'start' | 'end',
  timeZone: string | undefined
): ValidatedCalendarEventDateTime {
  const value = requiredString(args, key);
  const match = CALENDAR_EVENT_DATE_TIME_PATTERN.exec(value);
  if (match === null || !hasValidCalendarDateTimeParts(match)) {
    throw new Error(`Tool argument ${key} must be a valid ISO date-time string`);
  }
  const hasOffset = match[8] !== undefined;
  if (hasOffset) {
    return { value, hasOffset, comparisonMs: Date.parse(value) };
  }
  if (timeZone === undefined) {
    throw new Error(`Tool argument ${key} without an offset requires timeZone`);
  }
  const comparisonMs = resolveUniqueCalendarInstant(match, timeZone);
  if (!Number.isFinite(comparisonMs)) {
    throw new Error(
      `Tool argument ${key} must resolve to exactly one instant in timeZone; include an explicit offset`
    );
  }
  return { value, hasOffset, comparisonMs };
}

function hasValidCalendarDateTimeParts(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return false;
  const civil = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    civil.getUTCFullYear() !== year ||
    civil.getUTCMonth() !== month - 1 ||
    civil.getUTCDate() !== day ||
    civil.getUTCHours() !== hour ||
    civil.getUTCMinutes() !== minute ||
    civil.getUTCSeconds() !== second
  )
    return false;
  const offset = match[8];
  if (offset === undefined || offset === 'Z') return true;
  const offsetHour = Number(offset.slice(1, 3));
  const offsetMinute = Number(offset.slice(4, 6));
  return offsetHour <= 23 && offsetMinute <= 59;
}

function calendarWallClockMs(match: RegExpExecArray): number {
  const milliseconds = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    milliseconds
  );
}

function resolveUniqueCalendarInstant(match: RegExpExecArray, timeZone: string): number {
  const wallClockMs = calendarWallClockMs(match);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const possibleOffsets = new Set<number>();
  const halfHourMs = 30 * 60 * 1000;
  const searchRadiusMs = 36 * 60 * 60 * 1000;
  const alignedWallClockMs = Math.floor(wallClockMs / halfHourMs) * halfHourMs;
  for (let delta = -searchRadiusMs; delta <= searchRadiusMs; delta += halfHourMs) {
    const sampleMs = alignedWallClockMs + delta;
    const parts = readZonedCalendarParts(formatter, sampleMs);
    possibleOffsets.add(calendarWallClockFromParts(parts) - sampleMs);
  }
  const matches = [...possibleOffsets]
    .map((offsetMs) => wallClockMs - offsetMs)
    .filter((candidateMs) => sameCalendarWallClock(match, formatter, candidateMs));
  return matches.length === 1 ? Number(matches[0]) : Number.NaN;
}

interface CalendarDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readZonedCalendarParts(
  formatter: Intl.DateTimeFormat,
  instantMs: number
): CalendarDateTimeParts {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instantMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    second: Number(parts['second']),
  };
}

function calendarWallClockFromParts(parts: CalendarDateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

function sameCalendarWallClock(
  match: RegExpExecArray,
  formatter: Intl.DateTimeFormat,
  candidateMs: number
): boolean {
  const actual = readZonedCalendarParts(formatter, candidateMs);
  return (
    actual.year === Number(match[1]) &&
    actual.month === Number(match[2]) &&
    actual.day === Number(match[3]) &&
    actual.hour === Number(match[4]) &&
    actual.minute === Number(match[5]) &&
    actual.second === Number(match[6])
  );
}

function isValidTimeZone(value: string): boolean {
  if (value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function toQueryCalendarEventsArgs(args: Record<string, unknown>): QueryCalendarEventsToolArgs {
  const mode = requiredCalendarQueryMode(args, 'mode');
  const timeMin = requiredIsoDateTimeString(args, 'timeMin');
  const timeMax = requiredIsoDateTimeString(args, 'timeMax');
  const query = optionalString(args, 'query');
  const calendarId = optionalString(args, 'calendarId');
  const maxResults = optionalPositiveInteger(args, 'maxResults', { max: 2500 });

  if (Date.parse(timeMin) >= Date.parse(timeMax)) {
    throw new Error('Tool argument timeMax must be after timeMin');
  }

  return {
    mode,
    timeMin,
    timeMax,
    ...(query !== undefined ? { query } : {}),
    ...(calendarId !== undefined ? { calendarId } : {}),
    ...(maxResults !== undefined ? { maxResults } : {}),
  };
}

function toUpdateCalendarEventArgs(args: Record<string, unknown>): UpdateCalendarEventToolArgs {
  const eventId = requiredString(args, 'eventId');
  const eventSummary = requiredString(args, 'eventSummary');
  const attendeesToAdd = requiredEmailArray(args, 'attendeesToAdd');
  const calendarId = optionalString(args, 'calendarId');
  const expectedEtag = optionalString(args, 'expectedEtag');
  const eventStart = optionalCalendarDateTimeSnapshot(args, 'eventStart');
  const eventEnd = optionalCalendarDateTimeSnapshot(args, 'eventEnd');

  return {
    eventId,
    eventSummary,
    attendeesToAdd,
    ...(calendarId !== undefined ? { calendarId } : {}),
    ...(expectedEtag !== undefined ? { expectedEtag } : {}),
    ...(eventStart !== undefined ? { eventStart } : {}),
    ...(eventEnd !== undefined ? { eventEnd } : {}),
  };
}

function toCreateResearchArgs(args: Record<string, unknown>): CreateResearchToolArgs {
  const title = requiredString(args, 'title');
  const prompt = requiredString(args, 'prompt');
  const originalMessage = optionalString(args, 'originalMessage');
  const sourceMessageIds = optionalStringArray(args, 'sourceMessageIds');

  return {
    title,
    prompt,
    ...(originalMessage !== undefined ? { originalMessage } : {}),
    ...(sourceMessageIds !== undefined ? { sourceMessageIds } : {}),
  };
}

function toCreateLinkArgs(args: Record<string, unknown>): CreateLinkToolArgs {
  const url = requiredString(args, 'url');
  const title = optionalString(args, 'title');
  const description = optionalString(args, 'description');
  const tags = optionalStringArray(args, 'tags');
  const sourceMessageIds = optionalStringArray(args, 'sourceMessageIds');

  return {
    url,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(sourceMessageIds !== undefined ? { sourceMessageIds } : {}),
  };
}

function toCreateCodeTaskArgs(args: Record<string, unknown>): CreateCodeTaskToolArgs {
  const prompt = requiredString(args, 'prompt');
  const workerType = optionalCodeTaskWorkerType(args, 'workerType');
  const linearIssueId = optionalString(args, 'linearIssueId');
  const taskMode = optionalTaskMode(args, 'taskMode') ?? 'planning';

  return {
    prompt,
    ...(workerType !== undefined ? { workerType } : {}),
    ...(linearIssueId !== undefined ? { linearIssueId } : {}),
    taskMode,
  };
}

function optionalCodeTaskWorkerType(
  args: Record<string, unknown>,
  key: string
): (typeof EXPLICIT_CODE_TASK_WORKER_TYPES)[number] | undefined {
  const value = optionalString(args, key);
  if (value === undefined) return undefined;
  if (!(EXPLICIT_CODE_TASK_WORKER_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `Tool argument ${key} must be one of: ${EXPLICIT_CODE_TASK_WORKER_TYPES.join(', ')}`
    );
  }
  return value as (typeof EXPLICIT_CODE_TASK_WORKER_TYPES)[number];
}

function toSaveExternalArgs(args: Record<string, unknown>): SaveExternalToolArgs {
  const message = requiredString(args, 'message');
  const sourceUrl = optionalString(args, 'sourceUrl');

  return {
    message,
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
  };
}

function toAddUserPreferenceArgs(args: Record<string, unknown>): AddUserPreferenceToolArgs {
  return {
    text: requiredString(args, 'text'),
    expectedVersion: requiredNonNegativeInteger(args, 'expectedVersion'),
  };
}

function toUpdateUserPreferenceArgs(args: Record<string, unknown>): UpdateUserPreferenceToolArgs {
  return {
    itemId: requiredString(args, 'itemId'),
    text: requiredString(args, 'text'),
    expectedVersion: requiredNonNegativeInteger(args, 'expectedVersion'),
  };
}

function toDeleteUserPreferenceArgs(args: Record<string, unknown>): DeleteUserPreferenceToolArgs {
  return {
    itemId: requiredString(args, 'itemId'),
    expectedVersion: requiredNonNegativeInteger(args, 'expectedVersion'),
  };
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`Tool argument ${key} must be a string`);
  }
  return value;
}

function requiredNonNegativeInteger(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Tool argument ${key} must be a non-negative integer`);
  }
  return value;
}

function requiredIsoDateTimeString(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key);
  const validation = calendarListEventsRequestSchema.safeParse({
    userId: 'validator',
    timeMin: value,
    timeMax: value,
  });
  if (!validation.success) {
    throw new Error(`Tool argument ${key} must be an ISO date-time string`);
  }
  return value;
}

function optionalTaskMode(
  args: Record<string, unknown>,
  key: string
): 'planning' | 'execution' | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'planning' && value !== 'execution') {
    throw new Error(`Tool argument ${key} must be one of: planning, execution`);
  }
  return value;
}

function requiredCalendarQueryMode(
  args: Record<string, unknown>,
  key: string
): QueryCalendarEventsToolArgs['mode'] {
  const value = args[key];
  if (value !== 'list' && value !== 'count') {
    throw new Error(`Tool argument ${key} must be one of: list, count`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Tool argument ${key} must be a string`);
  }
  return value;
}

function optionalPositiveInteger(
  args: Record<string, unknown>,
  key: string,
  options: { max?: number } = {}
): number | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    (options.max !== undefined && value > options.max)
  ) {
    throw new Error(`Tool argument ${key} must be a positive integer`);
  }
  return value;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Tool argument ${key} must be an array of strings`);
  }
  return value;
}

function requiredNonEmptyStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Tool argument ${key} must be a non-empty string array`);
  }
  const strings: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`Tool argument ${key} must be a non-empty string array`);
    }
    strings.push(item);
  }
  return strings;
}

function requiredEmailArray(args: Record<string, unknown>, key: string): string[] {
  const value = requiredNonEmptyStringArray(args, key);
  const parsed = calendarUpdateEventAttendeesRequestSchema.safeParse({
    userId: 'intex-agent-tool-validation',
    calendarId: 'primary',
    expectedEtag: '"validation-etag"',
    attendeesToAdd: value.map((email) => ({ email })),
  });
  if (!parsed.success) {
    throw new Error(`Tool argument ${key} must contain valid email addresses`);
  }
  return value;
}

function optionalCalendarDateTimeSnapshot(
  args: Record<string, unknown>,
  key: string
): CalendarEventDateTimeSnapshot | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Tool argument ${key} must be a calendar date-time object`);
  }
  const parsed = calendarEventDateTimeSchema.safeParse(value);
  if (!parsed.success || (parsed.data.dateTime === undefined && parsed.data.date === undefined)) {
    throw new Error(`Tool argument ${key} must be a calendar date-time object`);
  }
  return {
    ...(parsed.data.dateTime !== undefined ? { dateTime: parsed.data.dateTime } : {}),
    ...(parsed.data.date !== undefined ? { date: parsed.data.date } : {}),
    ...(parsed.data.timeZone !== undefined ? { timeZone: parsed.data.timeZone } : {}),
  };
}
