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
  taskMode?: 'planning' | 'execution';
}

export interface IntexAgentToolExecutor {
  createNote(args: CreateNoteToolArgs): Promise<string>;
  createCalendarEvent(args: CreateCalendarEventToolArgs): Promise<string>;
  createResearch(args: CreateResearchToolArgs): Promise<string>;
  createLink(args: CreateLinkToolArgs): Promise<string>;
  createCodeTask(args: CreateCodeTaskToolArgs): Promise<string>;
}

export function createIntexAgentToolDefinitions(executor: IntexAgentToolExecutor): ToolDefinition[] {
  return [
    {
      name: 'create_note',
      description:
        'Use only when the user explicitly asks to create, save, note, remember, or write down a note or specific information. Do not use for greetings, smalltalk, follow-up complaints, read-only questions, or unsupported external tasks.',
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
        'Use only when the user wants a calendar event, appointment, meeting, scheduled block, or calendar item created. Do not use to list, inspect, summarize, or answer questions about existing calendar events. Ask a clarification before calling this tool if the title, date, time, start, or end is missing or ambiguous.',
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
      name: 'create_research',
      description:
        'Use only when the user explicitly says research, research draft, or asks to create a research draft about an external topic. Do not use for general explanations, "how does this work" questions, or to inspect personal IntexuraOS data such as calendar, notes, bookmarks, code tasks, or WhatsApp history.',
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
      description:
        'Use when the user explicitly asks to save a link, add a bookmark, bookmark a URL, or sends a bare URL / URL share with optional surrounding description. Do not use when the user explicitly asks for another resource that includes the URL.',
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
      description:
        'Use only when the user explicitly asks to create a code task, coding task, or programming task. Code tasks default to planning mode. Use execution mode only when the user explicitly asks for execution mode, says create code task execution, or says the task is in execution stage.',
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
            description:
              'Optional worker type. Set only when explicitly requested or specified by the user.',
          },
          linearIssueId: {
            type: 'string',
            description: 'Optional Linear issue ID to associate with the task.',
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
  const workerType = optionalString(args, 'workerType');
  const linearIssueId = optionalString(args, 'linearIssueId');
  const taskMode = optionalTaskMode(args, 'taskMode');

  return {
    prompt,
    ...(workerType !== undefined ? { workerType } : {}),
    ...(linearIssueId !== undefined ? { linearIssueId } : {}),
    ...(taskMode !== undefined ? { taskMode } : {}),
  };
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`Tool argument ${key} must be a string`);
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
