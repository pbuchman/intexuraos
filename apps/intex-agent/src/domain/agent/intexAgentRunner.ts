import { getErrorMessage } from '@intexuraos/common-core';
import type { ToolCallingClient, ToolCallingMessage } from '@intexuraos/llm-contract';
import type {
  IntexAgentRunner,
  IntexAgentRunnerResult,
} from '../messages/handleIncomingMessage.js';
import {
  formatUserMessageWithReplyContext,
  parseIncomingReplyContext,
} from '../messages/sessionMessageFormatting.js';
import type { IntexIncomingMessageReplyContext } from '../ports/incomingMessageHandler.js';
import type { IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';
import {
  createIntexAgentToolDefinitions,
  type AddUserPreferenceToolArgs,
  type CreateCalendarEventToolArgs,
  type CreateCodeTaskToolArgs,
  type CreateLinkToolArgs,
  type CreateNoteToolArgs,
  type DeleteUserPreferenceToolArgs,
  type QueryCalendarEventsToolArgs,
  type CreateResearchToolArgs,
  type SaveExternalToolArgs,
  type UpdateUserPreferenceToolArgs,
  type IntexAgentToolExecutor,
} from './toolDefinitions.js';
import { buildIntexAgentSystemPrompt } from './systemPrompt.js';
import { classifyIntexAgentIntent } from './intentGate.js';
import {
  buildGreetingReply,
  buildCompletionFailureCapabilitiesReply,
  buildUnsupportedCapabilitiesReply,
  selectIntexAgentReplyLanguage,
  type IntexAgentReplyLanguage,
} from './capabilities.js';
import type { IntexAgentIntentClassifier } from './intentClassifier.js';

const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';
type MutatingIntexAgentToolName = Exclude<
  IntexAgentToolName,
  'query_calendar_events' | 'get_user_preferences'
>;

const MUTATING_TOOL_NAMES = new Set<MutatingIntexAgentToolName>([
  'create_note',
  'create_calendar_event',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);

type LocalizedText = Record<IntexAgentReplyLanguage, string>;

const GENERIC_EXECUTION_FAILURE_PREFIX: LocalizedText = {
  en: 'I could not execute this action: ',
  pl: 'Nie udało się wykonać tej akcji: ',
};

const GENERIC_EXECUTION_FAILURE_SUFFIX: LocalizedText = {
  en: '. Please try again later.',
  pl: '. Spróbuj ponownie później.',
};

const EXTERNAL_SAVE_NOT_CONFIGURED_REPLIES: LocalizedText = {
  en: 'No external system is configured for this message, so I cannot process it. Configure external save in Intex Agent preferences and send it again.',
  pl: 'Nie skonfigurowano zewnętrznego systemu dla tej wiadomości, więc nie mogę jej przetworzyć. Skonfiguruj External Save w preferencjach agenta INTEX i wyślij ją ponownie.',
};

const EXTERNAL_SAVE_FAILURE_PREFIX: LocalizedText = {
  en: 'I could not deliver this to the external system. The external save request failed: ',
  pl: 'Nie udało się dostarczyć tej treści do zewnętrznego systemu. Żądanie External Save nie powiodło się: ',
};

const EXTERNAL_SAVE_FAILURE_SUFFIX: LocalizedText = {
  en: '. Please check the external system configuration and try again.',
  pl: '. Sprawdź konfigurację zewnętrznego systemu i spróbuj ponownie.',
};

const CONFIRMATION_INTROS: Record<MutatingIntexAgentToolName, LocalizedText> = {
  create_note: { en: 'Add this note?', pl: 'Czy dodać notatkę?' },
  create_calendar_event: {
    en: 'Add this calendar event?',
    pl: 'Czy dodać wydarzenie w kalendarzu?',
  },
  create_research: { en: 'Create this research draft?', pl: 'Czy utworzyć szkic researchu?' },
  create_link: { en: 'Save this bookmark?', pl: 'Czy zapisać bookmark?' },
  create_code_task: { en: 'Create this code task?', pl: 'Czy utworzyć zadanie programistyczne?' },
  save_external: {
    en: 'Send this content to the external system?',
    pl: 'Czy wysłać tę treść do zewnętrznego systemu?',
  },
  add_user_preference: {
    en: 'Add this instruction memory entry?',
    pl: 'Czy dodać wpis w pamięci instrukcji?',
  },
  update_user_preference: {
    en: 'Update this instruction memory entry?',
    pl: 'Czy zmodyfikować wpis w pamięci instrukcji?',
  },
  delete_user_preference: {
    en: 'Delete this instruction memory entry?',
    pl: 'Czy usunąć wpis z pamięci instrukcji?',
  },
};

const CONFIRMATION_LABELS = {
  title: { en: 'Title', pl: 'Tytuł' },
  content: { en: 'Content', pl: 'Treść' },
  start: { en: 'Start', pl: 'Początek' },
  end: { en: 'End', pl: 'Koniec' },
  location: { en: 'Location', pl: 'Miejsce' },
  attendees: { en: 'Attendees', pl: 'Uczestnicy' },
  prompt: { en: 'Prompt', pl: 'Polecenie' },
  mode: { en: 'Mode', pl: 'Tryb' },
  worker: { en: 'Worker', pl: 'Typ workera' },
  source: { en: 'Source', pl: 'Źródło' },
  newEntry: { en: 'New entry', pl: 'Nowy wpis' },
  entry: { en: 'Entry', pl: 'Wpis' },
  before: { en: 'Before', pl: 'Wcześniej' },
  after: { en: 'After', pl: 'Po zmianie' },
} satisfies Record<string, LocalizedText>;

const COMPLETED_REPLIES = {
  create_note: { en: 'Saved the note.', pl: 'Zapisałem notatkę.' },
  create_calendar_event: {
    en: 'Created the calendar event.',
    pl: 'Utworzyłem wydarzenie w kalendarzu.',
  },
  create_research: { en: 'Created the research draft.', pl: 'Utworzyłem szkic researchu.' },
  create_link: { en: 'Saved the bookmark.', pl: 'Zapisałem bookmark.' },
  create_code_task: { en: 'Created the code task.', pl: 'Utworzyłem zadanie programistyczne.' },
  save_external: { en: 'Saved externally', pl: 'Wysłano do zewnętrznego systemu.' },
  preference: {
    en: 'Updated the instruction memory.',
    pl: 'Zaktualizowałem pamięć instrukcji.',
  },
  preferencesEmpty: {
    en: 'No INTEX Agent preferences are defined yet.',
    pl: 'Nie zdefiniowano jeszcze preferencji agenta INTEX.',
  },
  linkUrl: { en: 'Saved the link.', pl: 'Zapisałem link.' },
} satisfies Record<string, LocalizedText>;

const CTA_LABELS = {
  openNote: { en: 'Open note', pl: 'Otwórz notatkę' },
  openResearch: { en: 'Open research', pl: 'Otwórz research' },
  viewProgress: { en: 'View progress', pl: 'Zobacz postęp' },
  openBookmark: { en: 'Open bookmark', pl: 'Otwórz zakładkę' },
  openCalendar: { en: 'Open calendar', pl: 'Otwórz kalendarz' },
  openLink: { en: 'Open link', pl: 'Otwórz link' },
} satisfies Record<string, LocalizedText>;

export interface IntexAgentRunnerConfig {
  client: ToolCallingClient;
  toolExecutor: IntexAgentToolExecutor;
  intentClassifier?: IntexAgentIntentClassifier;
  webAppUrl?: string;
  userPreferences?: string | null;
}

export function createIntexAgentRunner(config: IntexAgentRunnerConfig): IntexAgentRunner {
  return {
    async executeConfirmed(input): Promise<IntexAgentRunnerResult> {
      const replyLanguage = detectReplyLanguage(input.events ?? []);
      if (!isMutatingToolName(input.toolName)) {
        return malformedResult(replyLanguage);
      }

      const toolExecutions: IntexAgentToolExecution[] = [];
      const tools = createIntexAgentToolDefinitions(
        createTrackingToolExecutor(config.toolExecutor, toolExecutions)
      );
      const tool = tools.find((candidate) => candidate.name === input.toolName);
      /* v8 ignore start -- schema: mutating tool registry and tool definitions cannot diverge without breaking startup tests @preserve */
      if (tool === undefined) {
        return malformedResult(replyLanguage);
      }
      /* v8 ignore stop @preserve */

      try {
        const rawResult = await tool.run(input.toolArgs);
        const toolExecution = getCompletedToolExecution(toolExecutions);
        /* v8 ignore start -- schema: every mutating tool definition executes through the tracking executor after argument validation @preserve */
        if (toolExecution === undefined) {
          return malformedResult(replyLanguage);
        }
        /* v8 ignore stop @preserve */
        const parsedResult = parseToolResult(rawResult);
        const completedReply = buildCompletedReply(
          input.toolName,
          parsedResult,
          defaultCompletedReply(input.toolName, replyLanguage),
          config.webAppUrl ?? DEFAULT_WEB_APP_URL,
          replyLanguage
        );

        return {
          outcome: 'completed',
          reply: completedReply.reply,
          toolName: input.toolName,
          ...(parsedResult !== undefined ? { toolResult: parsedResult } : {}),
          ...(completedReply.ctaUrl !== undefined ? { ctaUrl: completedReply.ctaUrl } : {}),
        };
      } catch (error) {
        const errorMessage = getErrorMessage(error, 'Unknown tool execution error');
        return {
          outcome: 'tool_failed',
          reply: buildConfirmedExecutionFailureReply(input.toolName, errorMessage, replyLanguage),
          toolName: input.toolName,
          error: errorMessage,
        };
      }
    },
    async run(input): Promise<IntexAgentRunnerResult> {
      const replyLanguage = detectReplyLanguage(input.events, {
        text: input.message,
        ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
        ...(input.sourceUrl !== undefined ? { hasSourceUrl: true } : {}),
      });

      if (input.sourceType === 'whatsapp_image' && input.sourceUrl !== undefined) {
        const args = {
          message: input.message.trim() === '' ? 'Image shared via WhatsApp.' : input.message.trim(),
          sourceUrl: input.sourceUrl,
        };
        return {
          outcome: 'needs_confirmation',
          reply: buildConfirmationReply(
            'save_external',
            args,
            config.userPreferences ?? null,
            replyLanguage
          ),
          toolName: 'save_external',
          toolArgs: args,
        };
      }

      const intent =
        config.intentClassifier === undefined
          ? classifyIntexAgentIntent(input.message)
          : await config.intentClassifier.classify({
              message: input.message,
              events: input.events,
              currentDateTime: input.currentDateTime,
              ...(input.replyContext !== undefined ? { replyContext: input.replyContext } : {}),
            });
      if (intent.kind === 'unsupported') {
        return {
          outcome: 'unsupported',
          reply: unsupportedIntentReply(replyLanguage),
        };
      }

      if (intent.kind === 'needs_clarification') {
        return {
          outcome: 'needs_clarification',
          reply: intent.question,
        };
      }

      if (intent.kind === 'no_action' && intent.reason === 'greeting') {
        return {
          outcome: 'no_action',
          reply: buildGreetingReply(replyLanguage),
        };
      }

      const toolExecutions: IntexAgentToolExecution[] = [];
      const tools = createIntexAgentToolDefinitions(
        createTrackingToolExecutor(createConfirmationPreviewExecutor(config.toolExecutor), toolExecutions)
      ).filter(
        (tool) =>
          intent.kind === 'tool' && intent.allowedToolNames.includes(tool.name as IntexAgentToolName)
      );
      const systemPrompt = buildIntexAgentSystemPrompt.build({
        currentDateTime: input.currentDateTime,
        userPreferences: config.userPreferences ?? null,
      });
      const result = await config.client.run({
        systemPrompt,
        messages: buildMessages(input.events, input.message, input.replyContext),
        tools,
        toolChoice: 'auto',
        promptType: 'intex-agent-whatsapp-session',
        maxIterations: 5,
      });

      if (!result.ok) {
        return {
          outcome: 'unsupported',
          reply: buildCompletionFailureCapabilitiesReply(replyLanguage),
        };
      }

      return parseRunnerContent(
        result.value.content,
        toolExecutions,
        config.webAppUrl ?? DEFAULT_WEB_APP_URL,
        config.userPreferences ?? null,
        replyLanguage
      );
    },
  };
}

function detectReplyLanguage(
  events: IntexAgentSessionEvent[],
  currentMessage?: {
    text: string;
    sourceType?: string;
    hasSourceUrl?: boolean;
  }
): IntexAgentReplyLanguage {
  const priorMessages = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'user_message') {
      continue;
    }
    const priorMessage = event.payload['text'];
    if (typeof priorMessage === 'string') {
      priorMessages.push({
        text: priorMessage,
        ...(typeof event.payload['sourceType'] === 'string'
          ? { sourceType: event.payload['sourceType'] }
          : {}),
        ...(event.payload['hasSourceUrl'] === true ? { hasSourceUrl: true } : {}),
      });
    }
  }

  return selectIntexAgentReplyLanguage({
    ...(currentMessage !== undefined ? { currentMessage } : {}),
    priorMessages,
  });
}

interface IntexAgentToolExecution {
  toolName: IntexAgentToolName;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}

interface CompletedReply {
  reply: string;
  ctaUrl?: {
    displayText: string;
    url: string;
  };
}

function buildMessages(
  events: IntexAgentSessionEvent[],
  currentMessage: string,
  currentReplyContext?: IntexIncomingMessageReplyContext
): ToolCallingMessage[] {
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

  messages.push({
    role: 'user',
    content: formatUserMessageWithReplyContext(currentMessage, currentReplyContext),
  });
  return messages;
}

function messageFromEvent(event: IntexAgentSessionEvent): ToolCallingMessage | null {
  if (event.type === 'user_message') {
    const text = event.payload['text'];
    const replyContext = parseIncomingReplyContext(event.payload['replyContext']);
    return typeof text === 'string'
      ? { role: 'user', content: formatUserMessageWithReplyContext(text, replyContext) }
      : null;
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
  toolExecutions: IntexAgentToolExecution[],
  webAppUrl: string,
  userPreferences: string | null,
  replyLanguage: IntexAgentReplyLanguage
): IntexAgentRunnerResult {
  const parsed = parseJsonObject(content);
  if (parsed === null) {
    return malformedResult(replyLanguage);
  }

  const outcome = parsed['outcome'];
  const reply = parsed['reply'];
  if (typeof outcome !== 'string' || typeof reply !== 'string') {
    return malformedResult(replyLanguage);
  }

  const toolExecution = getCompletedToolExecution(toolExecutions);
  if (toolExecution !== undefined && isMutatingToolName(toolExecution.toolName)) {
    const summary = parsed['summary'];
    return {
      outcome: 'needs_confirmation',
      reply: buildConfirmationReply(
        toolExecution.toolName,
        toolExecution.args,
        userPreferences,
        replyLanguage
      ),
      toolName: toolExecution.toolName,
      toolArgs: toolExecution.args,
      ...(typeof summary === 'string' ? { summary } : {}),
    };
  }

  if (outcome === 'needs_clarification') {
    return { outcome, reply };
  }

  if (outcome === 'no_action') {
    return { outcome, reply };
  }

  if (outcome === 'unsupported') {
    return { outcome, reply: buildUnsupportedCapabilitiesReply(replyLanguage) };
  }

  if (outcome === 'completed') {
    const summary = parsed['summary'];
    if (toolExecution === undefined) {
      return malformedResult(replyLanguage);
    }
    const completedReply = buildCompletedReply(
      toolExecution.toolName,
      toolExecution.result,
      reply,
      webAppUrl,
      replyLanguage
    );

    return {
      outcome,
      reply: completedReply.reply,
      ...(typeof summary === 'string' ? { summary } : {}),
      toolName: toolExecution.toolName,
      ...(toolExecution.result !== undefined
        ? { toolResult: toolExecution.result }
        : {}),
      /* v8 ignore start -- schema: normal completed turns cannot produce CTA URLs because mutating tools are confirmation-gated and read-only tools have no CTA results @preserve */
      ...(completedReply.ctaUrl !== undefined ? { ctaUrl: completedReply.ctaUrl } : {}),
      /* v8 ignore stop @preserve */
    };
  }

  return malformedResult(replyLanguage);
}

function createConfirmationPreviewExecutor(executor: IntexAgentToolExecutor): IntexAgentToolExecutor {
  return {
    createNote(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    createCalendarEvent(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    async queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string> {
      return await executor.queryCalendarEvents(args);
    },
    createResearch(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    createLink(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    createCodeTask(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    saveExternal(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    async getUserPreferences(): Promise<string> {
      return await executor.getUserPreferences();
    },
    addUserPreference(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    updateUserPreference(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    deleteUserPreference(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
  };
}

function previewToolResult(): string {
  return JSON.stringify({ status: 'needs_confirmation' });
}

function isMutatingToolName(toolName: IntexAgentToolName): toolName is MutatingIntexAgentToolName {
  return MUTATING_TOOL_NAMES.has(toolName as MutatingIntexAgentToolName);
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
    try {
      const rawResult = await run();
      const parsedResult = parseToolResult(rawResult);
      toolExecutions.push({
        toolName,
        args,
        ...(parsedResult !== undefined ? { result: parsedResult } : {}),
      });
      return rawResult;
    } catch (error) {
      toolExecutions.push({
        toolName,
        args,
        error: getErrorMessage(error, 'Unknown external save error'),
      });
      throw error;
    }
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
    async queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string> {
      return await track(
        'query_calendar_events',
        toRecord(args),
        async () => await executor.queryCalendarEvents(args)
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
    async saveExternal(args: SaveExternalToolArgs): Promise<string> {
      return await track('save_external', toRecord(args), async () => await executor.saveExternal(args));
    },
    async getUserPreferences(): Promise<string> {
      return await track('get_user_preferences', {}, async () => await executor.getUserPreferences());
    },
    async addUserPreference(args: AddUserPreferenceToolArgs): Promise<string> {
      return await track(
        'add_user_preference',
        toRecord(args),
        async () => await executor.addUserPreference(args)
      );
    },
    async updateUserPreference(args: UpdateUserPreferenceToolArgs): Promise<string> {
      return await track(
        'update_user_preference',
        toRecord(args),
        async () => await executor.updateUserPreference(args)
      );
    },
    async deleteUserPreference(args: DeleteUserPreferenceToolArgs): Promise<string> {
      return await track(
        'delete_user_preference',
        toRecord(args),
        async () => await executor.deleteUserPreference(args)
      );
    },
  };
}

function buildExternalSaveFailureReply(
  errorMessage: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (isExternalSaveNotConfiguredError(errorMessage)) {
    return EXTERNAL_SAVE_NOT_CONFIGURED_REPLIES[replyLanguage];
  }

  const detail = normalizeExternalSaveFailureDetail(errorMessage);
  return `${EXTERNAL_SAVE_FAILURE_PREFIX[replyLanguage]}${detail}${EXTERNAL_SAVE_FAILURE_SUFFIX[replyLanguage]}`;
}

function buildConfirmedExecutionFailureReply(
  toolName: IntexAgentToolName,
  errorMessage: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (toolName === 'save_external') {
    return buildExternalSaveFailureReply(errorMessage, replyLanguage);
  }

  const detail = normalizeExternalSaveFailureDetail(errorMessage);
  return `${GENERIC_EXECUTION_FAILURE_PREFIX[replyLanguage]}${detail}${GENERIC_EXECUTION_FAILURE_SUFFIX[replyLanguage]}`;
}

function isExternalSaveNotConfiguredError(errorMessage: string): boolean {
  return errorMessage.trim() === 'External save is not configured';
}

function normalizeExternalSaveFailureDetail(errorMessage: string): string {
  const normalized = errorMessage.trim().replace(/^Failed to save externally:\s*/i, '');
  const withoutTrailingPeriod = normalized.replace(/\.+$/u, '').trim();
  return withoutTrailingPeriod === '' ? 'Unknown external save error' : withoutTrailingPeriod;
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

function buildConfirmationReply(
  toolName: MutatingIntexAgentToolName,
  args: Record<string, unknown>,
  userPreferences: string | null,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (toolName === 'create_note') {
    const lines = [CONFIRMATION_INTROS.create_note[replyLanguage]];
    const title = readRawString(args, 'title');
    const content = readRawString(args, 'content');
    if (title !== undefined) lines.push('', `${CONFIRMATION_LABELS.title[replyLanguage]}: ${title}`);
    /* v8 ignore start -- schema: create_note preview args cannot omit content because validation runs before confirmation text is built @preserve */
    if (content !== undefined) {
      lines.push(`${CONFIRMATION_LABELS.content[replyLanguage]}: ${content}`);
    }
    /* v8 ignore stop @preserve */
    return lines.join('\n');
  }

  if (toolName === 'create_calendar_event') {
    const lines = [CONFIRMATION_INTROS.create_calendar_event[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.title[replyLanguage], readRawString(args, 'summary'));
    appendConfirmationLine(lines, CONFIRMATION_LABELS.start[replyLanguage], readRawString(args, 'start'));
    appendConfirmationLine(lines, CONFIRMATION_LABELS.end[replyLanguage], readRawString(args, 'end'));
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.location[replyLanguage],
      readRawString(args, 'location')
    );
    appendConfirmationListLine(
      lines,
      CONFIRMATION_LABELS.attendees[replyLanguage],
      readStringArray(args, 'attendees')
    );
    return lines.join('\n');
  }

  if (toolName === 'create_research') {
    const lines = [CONFIRMATION_INTROS.create_research[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.title[replyLanguage], readRawString(args, 'title'));
    appendConfirmationLine(lines, CONFIRMATION_LABELS.prompt[replyLanguage], readRawString(args, 'prompt'));
    return lines.join('\n');
  }

  if (toolName === 'create_link') {
    const lines = [CONFIRMATION_INTROS.create_link[replyLanguage]];
    appendConfirmationLine(lines, 'URL', readRawString(args, 'url'));
    appendConfirmationLine(lines, CONFIRMATION_LABELS.title[replyLanguage], readRawString(args, 'title'));
    return lines.join('\n');
  }

  if (toolName === 'create_code_task') {
    const lines = [CONFIRMATION_INTROS.create_code_task[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.prompt[replyLanguage], readRawString(args, 'prompt'));
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.mode[replyLanguage],
      readRawString(args, 'taskMode') ?? 'planning'
    );
    appendConfirmationLine(lines, CONFIRMATION_LABELS.worker[replyLanguage], readRawString(args, 'workerType'));
    appendConfirmationLine(lines, 'Linear', readRawString(args, 'linearIssueId'));
    return lines.join('\n');
  }

  if (toolName === 'save_external') {
    const lines = [CONFIRMATION_INTROS.save_external[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.content[replyLanguage], readRawString(args, 'message'));
    appendConfirmationLine(lines, CONFIRMATION_LABELS.source[replyLanguage], readRawString(args, 'sourceUrl'));
    return lines.join('\n');
  }

  if (toolName === 'add_user_preference') {
    const lines = [CONFIRMATION_INTROS.add_user_preference[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.newEntry[replyLanguage], readRawString(args, 'text'));
    return lines.join('\n');
  }

  if (toolName === 'update_user_preference') {
    const lines = [CONFIRMATION_INTROS.update_user_preference[replyLanguage]];
    const itemId = readRawString(args, 'itemId');
    appendConfirmationLine(lines, CONFIRMATION_LABELS.entry[replyLanguage], itemId);
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.before[replyLanguage],
      findPreferenceText(userPreferences, itemId)
    );
    appendConfirmationLine(lines, CONFIRMATION_LABELS.after[replyLanguage], readRawString(args, 'text'));
    return lines.join('\n');
  }

  const lines = [CONFIRMATION_INTROS.delete_user_preference[replyLanguage]];
  const itemId = readRawString(args, 'itemId');
  appendConfirmationLine(lines, CONFIRMATION_LABELS.entry[replyLanguage], itemId);
  appendConfirmationLine(
    lines,
    CONFIRMATION_LABELS.content[replyLanguage],
    findPreferenceText(userPreferences, itemId)
  );
  return lines.join('\n');
}

function appendConfirmationLine(lines: string[], label: string, value: string | undefined): void {
  if (value === undefined || value.trim() === '') {
    return;
  }
  if (lines.length === 1) {
    lines.push('');
  }
  lines.push(`${label}: ${value}`);
}

function appendConfirmationListLine(
  lines: string[],
  label: string,
  value: string[] | undefined
): void {
  if (value === undefined || value.length === 0) {
    return;
  }
  appendConfirmationLine(lines, label, value.join(', '));
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return undefined;
  }
  return value;
}

function findPreferenceText(userPreferences: string | null, itemId: string | undefined): string | undefined {
  if (userPreferences === null || itemId === undefined) {
    return undefined;
  }
  const line = userPreferences.split('\n').find((candidate) => candidate.includes(`(id: ${itemId}) `));
  if (line === undefined) {
    return undefined;
  }
  const quotedText = line.slice(line.indexOf(') ') + 2).trim();
  try {
    const parsed: unknown = JSON.parse(quotedText);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return quotedText;
  }
}

function buildCompletedReply(
  toolName: IntexAgentToolName,
  result: Record<string, unknown> | undefined,
  fallbackReply: string,
  webAppUrl: string,
  replyLanguage: IntexAgentReplyLanguage
): CompletedReply {
  if (result === undefined) {
    return { reply: fallbackReply };
  }

  if (isPreferenceToolName(toolName)) {
    const promptBlock = readRawString(result, 'promptBlock');
    return {
      reply:
        promptBlock !== undefined && promptBlock.trim() !== ''
          ? promptBlock
          : COMPLETED_REPLIES.preferencesEmpty[replyLanguage],
    };
  }

  const resourceUrl = readString(result, 'resourceUrl');
  const absoluteResourceUrl = toObjectCtaUrl(resourceUrl, webAppUrl);
  if (absoluteResourceUrl !== undefined) {
    if (toolName === 'create_note') {
      return {
        reply: COMPLETED_REPLIES.create_note[replyLanguage],
        ctaUrl: { displayText: CTA_LABELS.openNote[replyLanguage], url: absoluteResourceUrl },
      };
    }
    if (toolName === 'create_research') {
      return {
        reply: COMPLETED_REPLIES.create_research[replyLanguage],
        ctaUrl: { displayText: CTA_LABELS.openResearch[replyLanguage], url: absoluteResourceUrl },
      };
    }
    if (toolName === 'create_code_task') {
      return {
        reply: COMPLETED_REPLIES.create_code_task[replyLanguage],
        ctaUrl: { displayText: CTA_LABELS.viewProgress[replyLanguage], url: absoluteResourceUrl },
      };
    }
    if (toolName === 'create_link') {
      return {
        reply: COMPLETED_REPLIES.create_link[replyLanguage],
        ctaUrl: { displayText: CTA_LABELS.openBookmark[replyLanguage], url: absoluteResourceUrl },
      };
    }
  }
  if (resourceUrl !== undefined) {
    if (toolName === 'create_research') {
      return {
        reply: `${COMPLETED_REPLIES.create_research[replyLanguage].replace(/\.$/u, '')}: ${resourceUrl}`,
      };
    }
    if (toolName === 'create_code_task') {
      return {
        reply: `${COMPLETED_REPLIES.create_code_task[replyLanguage].replace(/\.$/u, '')}: ${resourceUrl}`,
      };
    }
    return { reply: `${fallbackReply.trim()} ${resourceUrl}`.trim() };
  }

  const htmlLink = readString(result, 'htmlLink');
  const absoluteHtmlLink = toAbsoluteUrl(htmlLink);
  if (toolName === 'create_calendar_event' && absoluteHtmlLink !== undefined) {
    return {
      reply: COMPLETED_REPLIES.create_calendar_event[replyLanguage],
      ctaUrl: { displayText: CTA_LABELS.openCalendar[replyLanguage], url: absoluteHtmlLink },
    };
  }
  if (htmlLink !== undefined && toolName === 'create_calendar_event') {
    return {
      reply: `${COMPLETED_REPLIES.create_calendar_event[replyLanguage].replace(/\.$/u, '')}: ${htmlLink}`,
    };
  }

  const url = readString(result, 'url');
  const absoluteUrl = toAbsoluteUrl(url);
  if (toolName === 'create_link' && absoluteUrl !== undefined) {
    return {
      reply: COMPLETED_REPLIES.linkUrl[replyLanguage],
      ctaUrl: { displayText: CTA_LABELS.openLink[replyLanguage], url: absoluteUrl },
    };
  }
  if (url !== undefined && toolName === 'create_link') {
    return {
      reply: `${COMPLETED_REPLIES.linkUrl[replyLanguage].replace(/\.$/u, '')}: ${url}`,
    };
  }

  const message = readString(result, 'message');
  if (toolName === 'save_external' && message !== undefined) {
    return { reply: COMPLETED_REPLIES.save_external[replyLanguage] };
  }
  return { reply: fallbackReply };
}

function defaultCompletedReply(
  toolName: MutatingIntexAgentToolName,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (toolName === 'create_note') {
    return COMPLETED_REPLIES.create_note[replyLanguage];
  }
  if (toolName === 'create_calendar_event') {
    return COMPLETED_REPLIES.create_calendar_event[replyLanguage];
  }
  if (toolName === 'create_research') {
    return COMPLETED_REPLIES.create_research[replyLanguage];
  }
  if (toolName === 'create_link') {
    return COMPLETED_REPLIES.create_link[replyLanguage];
  }
  if (toolName === 'create_code_task') {
    return COMPLETED_REPLIES.create_code_task[replyLanguage];
  }
  if (toolName === 'save_external') {
    return COMPLETED_REPLIES.save_external[replyLanguage];
  }
  return COMPLETED_REPLIES.preference[replyLanguage];
}

function isPreferenceToolName(toolName: IntexAgentToolName): boolean {
  return (
    toolName === 'get_user_preferences' ||
    toolName === 'add_user_preference' ||
    toolName === 'update_user_preference' ||
    toolName === 'delete_user_preference'
  );
}

function readRawString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function toObjectCtaUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value, normalizeBaseUrl(baseUrl));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function toAbsoluteUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
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

function malformedResult(replyLanguage: IntexAgentReplyLanguage = 'en'): IntexAgentRunnerResult {
  return {
    outcome: 'unsupported',
    reply: buildUnsupportedCapabilitiesReply(replyLanguage),
  };
}

function unsupportedIntentReply(replyLanguage: IntexAgentReplyLanguage): string {
  return buildUnsupportedCapabilitiesReply(replyLanguage);
}
