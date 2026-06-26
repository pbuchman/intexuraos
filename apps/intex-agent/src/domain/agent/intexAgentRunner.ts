import type { ToolCallingClient, ToolCallingMessage } from '@intexuraos/llm-contract';
import type {
  IntexAgentRunner,
  IntexAgentRunnerResult,
} from '../messages/handleIncomingMessage.js';
import type { IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';
import {
  createIntexAgentToolDefinitions,
  type CreateCalendarEventToolArgs,
  type CreateCodeTaskToolArgs,
  type CreateLinkToolArgs,
  type CreateNoteToolArgs,
  type CreateResearchToolArgs,
  type IntexAgentToolExecutor,
} from './toolDefinitions.js';
import { INTEX_AGENT_SYSTEM_PROMPT } from './systemPrompt.js';
import { classifyIntexAgentIntent } from './intentGate.js';

const SUPPORTED_CAPABILITIES =
  'notes, calendar events, research drafts, bookmarks, and code tasks';

export interface IntexAgentRunnerConfig {
  client: ToolCallingClient;
  toolExecutor: IntexAgentToolExecutor;
}

export function createIntexAgentRunner(config: IntexAgentRunnerConfig): IntexAgentRunner {
  return {
    async run(input): Promise<IntexAgentRunnerResult> {
      const intent = classifyIntexAgentIntent(input.message);
      if (intent.kind === 'unsupported') {
        return {
          outcome: 'unsupported',
          reply: unsupportedIntentReply(intent.reason),
        };
      }

      if (intent.kind === 'no_action' && intent.reason === 'greeting') {
        return {
          outcome: 'no_action',
          reply: 'Cześć! U mnie wszystko w porządku. W czym mogę pomóc?',
        };
      }

      const toolExecutions: IntexAgentToolExecution[] = [];
      const tools = createIntexAgentToolDefinitions(
        createTrackingToolExecutor(config.toolExecutor, toolExecutions)
      ).filter(
        (tool) =>
          intent.kind === 'tool' && intent.allowedToolNames.includes(tool.name as IntexAgentToolName)
      );
      const result = await config.client.run({
        systemPrompt: INTEX_AGENT_SYSTEM_PROMPT.text,
        messages: buildMessages(input.events, input.message),
        tools,
        toolChoice: 'auto',
        promptType: 'intex-agent-whatsapp-session',
        maxIterations: 5,
      });

      if (!result.ok) {
        return {
          outcome: 'unsupported',
          reply: `I could not complete that request right now. I can create ${SUPPORTED_CAPABILITIES}.`,
        };
      }

      return parseRunnerContent(result.value.content, toolExecutions);
    },
  };
}

interface IntexAgentToolExecution {
  toolName: IntexAgentToolName;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
}

function buildMessages(events: IntexAgentSessionEvent[], currentMessage: string): ToolCallingMessage[] {
  const messages: ToolCallingMessage[] = [];

  for (const event of events) {
    const message = messageFromEvent(event);
    if (message !== null) {
      const previousMessage = messages[messages.length - 1];
      if (
        previousMessage?.role === 'assistant' &&
        message.role === 'assistant' &&
        previousMessage.content === message.content
      ) {
        continue;
      }
      messages.push(message);
    }
  }

  messages.push({ role: 'user', content: currentMessage });
  return messages;
}

function messageFromEvent(event: IntexAgentSessionEvent): ToolCallingMessage | null {
  if (event.type === 'user_message') {
    const text = event.payload['text'];
    return typeof text === 'string' ? { role: 'user', content: text } : null;
  }

  if (event.type === 'clarification_requested') {
    const message = event.payload['message'];
    return typeof message === 'string' ? { role: 'assistant', content: message } : null;
  }

  if (event.type === 'assistant_message') {
    const text = event.payload['text'];
    return typeof text === 'string' ? { role: 'assistant', content: text } : null;
  }

  if (event.type === 'tool_call_completed') {
    const toolName = event.payload['toolName'];
    const result = event.payload['result'];
    if (typeof toolName !== 'string') {
      return null;
    }
    return {
      role: 'assistant',
      content: `Tool ${toolName} completed: ${JSON.stringify(result ?? {})}`,
    };
  }

  return null;
}

function parseRunnerContent(
  content: string,
  toolExecutions: IntexAgentToolExecution[]
): IntexAgentRunnerResult {
  const parsed = parseJsonObject(content);
  if (parsed === null) {
    return malformedResult();
  }

  const outcome = parsed['outcome'];
  const reply = parsed['reply'];
  if (typeof outcome !== 'string' || typeof reply !== 'string') {
    return malformedResult();
  }

  if (outcome === 'needs_clarification') {
    return { outcome, reply };
  }

  if (outcome === 'no_action') {
    return { outcome, reply };
  }

  if (outcome === 'unsupported') {
    return { outcome, reply };
  }

  if (outcome === 'completed') {
    const summary = parsed['summary'];
    const completedToolExecution = getCompletedToolExecution(toolExecutions);
    if (completedToolExecution === undefined) {
      return malformedResult();
    }

    return {
      outcome,
      reply: buildCompletedReply(completedToolExecution.toolName, completedToolExecution.result, reply),
      ...(typeof summary === 'string' ? { summary } : {}),
      toolName: completedToolExecution.toolName,
      ...(completedToolExecution.result !== undefined
        ? { toolResult: completedToolExecution.result }
        : {}),
    };
  }

  return malformedResult();
}

function createTrackingToolExecutor(
  executor: IntexAgentToolExecutor,
  toolExecutions: IntexAgentToolExecution[]
): IntexAgentToolExecutor {
  async function track(
    toolName: IntexAgentToolName,
    args: Record<string, unknown>,
    run: () => Promise<string>
  ): Promise<string> {
    const rawResult = await run();
    const parsedResult = parseToolResult(rawResult);
    toolExecutions.push({
      toolName,
      args,
      ...(parsedResult !== undefined ? { result: parsedResult } : {}),
    });
    return rawResult;
  }

  return {
    async createNote(args: CreateNoteToolArgs): Promise<string> {
      return await track('create_note', toRecord(args), async () => await executor.createNote(args));
    },
    async createCalendarEvent(args: CreateCalendarEventToolArgs): Promise<string> {
      return await track(
        'create_calendar_event',
        toRecord(args),
        async () => await executor.createCalendarEvent(args)
      );
    },
    async createResearch(args: CreateResearchToolArgs): Promise<string> {
      return await track('create_research', toRecord(args), async () => await executor.createResearch(args));
    },
    async createLink(args: CreateLinkToolArgs): Promise<string> {
      return await track('create_link', toRecord(args), async () => await executor.createLink(args));
    },
    async createCodeTask(args: CreateCodeTaskToolArgs): Promise<string> {
      return await track('create_code_task', toRecord(args), async () => await executor.createCodeTask(args));
    },
  };
}

function toRecord(args: object): Record<string, unknown> {
  return { ...args };
}

function getCompletedToolExecution(
  toolExecutions: IntexAgentToolExecution[]
): IntexAgentToolExecution | undefined {
  const uniqueExecutedToolNames = [...new Set(toolExecutions.map((execution) => execution.toolName))];
  if (uniqueExecutedToolNames.length === 1 && toolExecutions.length === 1) {
    return toolExecutions[0];
  }

  /* v8 ignore start -- schema: impossible after intent gating exposes at most one tool per turn @preserve */
  if (uniqueExecutedToolNames.length > 1) {
    return undefined;
  }
  /* v8 ignore stop @preserve */

  return undefined;
}

function parseToolResult(rawResult: string): Record<string, unknown> | undefined {
  return parseJsonObject(rawResult) ?? undefined;
}

function buildCompletedReply(
  toolName: IntexAgentToolName,
  result: Record<string, unknown> | undefined,
  fallbackReply: string
): string {
  if (result === undefined) {
    return fallbackReply;
  }

  const resourceUrl = readString(result, 'resourceUrl');
  if (resourceUrl !== undefined) {
    if (toolName === 'create_research') {
      return `Utworzyłem szkic researchu: ${resourceUrl}`;
    }
    if (toolName === 'create_code_task') {
      return `Utworzyłem zadanie programistyczne: ${resourceUrl}`;
    }
    return `${fallbackReply.trim()} ${resourceUrl}`.trim();
  }

  const htmlLink = readString(result, 'htmlLink');
  if (htmlLink !== undefined && toolName === 'create_calendar_event') {
    return `Utworzyłem wydarzenie w kalendarzu: ${htmlLink}`;
  }

  const url = readString(result, 'url');
  if (url !== undefined && toolName === 'create_link') {
    return `Zapisałem link: ${url}`;
  }

  const message = readString(result, 'message');
  return message ?? fallbackReply;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function malformedResult(): IntexAgentRunnerResult {
  return {
    outcome: 'unsupported',
    reply: `I could not safely understand that request. I can create ${SUPPORTED_CAPABILITIES}.`,
  };
}

function unsupportedIntentReply(
  reason: 'read_only_personal_data' | 'multiple_resource_intents'
): string {
  if (reason === 'read_only_personal_data') {
    return 'Nie mogę jeszcze przeglądać Twojego kalendarza ani sprawdzać zaplanowanych wydarzeń. Mogę utworzyć nowe wydarzenie, jeśli poprosisz o to wprost.';
  }

  return `I could not safely understand that request. I can create ${SUPPORTED_CAPABILITIES}.`;
}
