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

const SUPPORTED_CAPABILITIES =
  'notes, calendar events, research drafts, bookmarks, and code tasks';

export interface IntexAgentRunnerConfig {
  client: ToolCallingClient;
  toolExecutor: IntexAgentToolExecutor;
}

export function createIntexAgentRunner(config: IntexAgentRunnerConfig): IntexAgentRunner {
  return {
    async run(input): Promise<IntexAgentRunnerResult> {
      const executedToolNames: IntexAgentToolName[] = [];
      const result = await config.client.run({
        systemPrompt: INTEX_AGENT_SYSTEM_PROMPT.text,
        messages: buildMessages(input.events, input.message),
        tools: createIntexAgentToolDefinitions(
          createTrackingToolExecutor(config.toolExecutor, executedToolNames)
        ),
        promptType: 'intex-agent-whatsapp-session',
        maxIterations: 5,
      });

      if (!result.ok) {
        return {
          outcome: 'unsupported',
          reply: `I could not complete that request right now. I can create ${SUPPORTED_CAPABILITIES}.`,
        };
      }

      return parseRunnerContent(result.value.content, executedToolNames);
    },
  };
}

function buildMessages(events: IntexAgentSessionEvent[], currentMessage: string): ToolCallingMessage[] {
  const messages: ToolCallingMessage[] = [];

  for (const event of events) {
    const message = messageFromEvent(event);
    if (message !== null) {
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

  return null;
}

function parseRunnerContent(
  content: string,
  executedToolNames: IntexAgentToolName[]
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
    const toolName = parsed['toolName'];
    const completedToolName = getCompletedToolName(toolName, executedToolNames);
    if (completedToolName === undefined) {
      return malformedResult();
    }

    return {
      outcome,
      reply,
      ...(typeof summary === 'string' ? { summary } : {}),
      toolName: completedToolName,
    };
  }

  return malformedResult();
}

function createTrackingToolExecutor(
  executor: IntexAgentToolExecutor,
  executedToolNames: IntexAgentToolName[]
): IntexAgentToolExecutor {
  return {
    async createNote(args: CreateNoteToolArgs): Promise<string> {
      executedToolNames.push('create_note');
      return await executor.createNote(args);
    },
    async createCalendarEvent(args: CreateCalendarEventToolArgs): Promise<string> {
      executedToolNames.push('create_calendar_event');
      return await executor.createCalendarEvent(args);
    },
    async createResearch(args: CreateResearchToolArgs): Promise<string> {
      executedToolNames.push('create_research');
      return await executor.createResearch(args);
    },
    async createLink(args: CreateLinkToolArgs): Promise<string> {
      executedToolNames.push('create_link');
      return await executor.createLink(args);
    },
    async createCodeTask(args: CreateCodeTaskToolArgs): Promise<string> {
      executedToolNames.push('create_code_task');
      return await executor.createCodeTask(args);
    },
  };
}

function getCompletedToolName(
  parsedToolName: unknown,
  executedToolNames: IntexAgentToolName[]
): IntexAgentToolName | undefined {
  const uniqueExecutedToolNames = [...new Set(executedToolNames)];
  if (uniqueExecutedToolNames.length === 1) {
    const [executedToolName] = uniqueExecutedToolNames as [IntexAgentToolName];
    return executedToolName;
  }

  if (uniqueExecutedToolNames.length > 1) {
    return undefined;
  }

  return isSupportedToolName(parsedToolName) ? parsedToolName : undefined;
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

function isSupportedToolName(toolName: unknown): toolName is IntexAgentToolName {
  return (
    toolName === 'create_note' ||
    toolName === 'create_calendar_event' ||
    toolName === 'create_research' ||
    toolName === 'create_link' ||
    toolName === 'create_code_task'
  );
}
