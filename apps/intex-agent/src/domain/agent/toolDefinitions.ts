import type { ToolDefinition } from '@intexuraos/llm-contract';

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

export interface IntexAgentToolExecutor {
  createNote(args: CreateNoteToolArgs): Promise<string>;
  createCalendarEvent(args: CreateCalendarEventToolArgs): Promise<string>;
}

export function createIntexAgentToolDefinitions(executor: IntexAgentToolExecutor): ToolDefinition[] {
  return [
    {
      name: 'create_note',
      description:
        'Use when the user asks to remember, save, note, write down, keep, or store information for later. Do not use for unsupported external tasks.',
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
      description:
        'Use when the user wants a calendar event, appointment, meeting, scheduled block, or calendar item created. Ask a clarification before calling this tool if the title, date, time, start, or end is missing or ambiguous.',
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
  const start = requiredString(args, 'start');
  const end = requiredString(args, 'end');
  const timeZone = optionalString(args, 'timeZone');
  const location = optionalString(args, 'location');
  const description = optionalString(args, 'description');
  const attendees = optionalStringArray(args, 'attendees');

  return {
    summary,
    start,
    end,
    ...(timeZone !== undefined ? { timeZone } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(attendees !== undefined ? { attendees } : {}),
  };
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`Tool argument ${key} must be a string`);
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
