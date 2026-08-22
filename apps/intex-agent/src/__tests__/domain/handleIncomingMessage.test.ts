import { err, ok } from '@intexuraos/common-core';
import { IntexAgentModels } from '@intexuraos/llm-contract';
import type { IntexAgentRuntimeSettingsV1 } from '@intexuraos/internal-clients';
import type { ToolCallingClient, ToolCallingResult } from '@intexuraos/llm-contract';
import { describe, expect, it, vi } from 'vitest';
import { createIntexAgentRunner } from '../../domain/agent/intexAgentRunner.js';
import type { IntexAgentToolExecutor } from '../../domain/agent/toolDefinitions.js';
import type { IntexIncomingMessage } from '../../domain/ports/incomingMessageHandler.js';
import type {
  SessionRepository,
  SessionRepositorySessionDraft,
  SessionRepositorySessionUpdate,
} from '../../domain/ports/sessionRepository.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
  IntexAgentSessionEventType,
  IntexAgentToolName,
} from '../../domain/sessions/types.js';
import { buildUnsupportedCapabilitiesReply } from '../../domain/agent/capabilities.js';
import {
  handleIncomingMessage,
  type IntexAgentRunner,
  type IntexAgentRunnerResult,
  type WhatsAppReplyPublisher,
} from '../../domain/messages/handleIncomingMessage.js';

const NOW = '2026-06-24T10:00:00.000Z';
const NEW_SESSION_READY_REPLY = [
  'What would you like me to help with? I can help with:',
  '- summarize and reason over the current session',
  '- create notes',
  '- create, look up, and update calendar events',
  '- create research drafts',
  '- save bookmarks',
  '- create code tasks for planning or execution',
  '- manage Intex Agent prompt preferences',
].join('\n');
const POLISH_NEW_SESSION_READY_REPLY = [
  'W czym mogę pomóc? Mogę pomóc z:',
  '- podsumowywaniem i analizowaniem bieżącej sesji',
  '- tworzeniem notatek',
  '- tworzeniem, sprawdzaniem i aktualizowaniem wydarzeń w kalendarzu',
  '- tworzeniem szkiców researchu',
  '- zapisywaniem bookmarków',
  '- tworzeniem zadań programistycznych do planowania lub wykonania',
  '- zarządzaniem preferencjami promptu agenta Intex',
].join('\n');

function message(overrides: Partial<IntexIncomingMessage> = {}): IntexIncomingMessage {
  return {
    type: 'intex.message.ingest',
    userId: 'user-1',
    messageId: 'wamid-1',
    text: 'remember that the door code is 1234',
    sourceType: 'whatsapp_text',
    timestamp: NOW,
    ...overrides,
  };
}

describe('handleIncomingMessage', () => {
  it('resolves one immutable runtime snapshot before an ordinary runner turn', async () => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const runtimeDto: IntexAgentRuntimeSettingsV1 = {
      status: 'available' as const,
      effectiveModel: IntexAgentModels.MiniMaxM3,
      explicitModel: IntexAgentModels.MiniMaxM3,
      source: 'explicit' as const,
      revision: 4,
      timeZone: 'Europe/Warsaw',
    };
    const resolveRuntimeSettings = vi.fn(async () => ok(runtimeDto));
    const runner: IntexAgentRunner = {
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        throw new Error('not used');
      },
      async run(input): Promise<IntexAgentRunnerResult> {
        expect(input.runtimeSettings).toEqual(runtimeDto);
        expect(input.runtimeSettings).toBeDefined();
        if (input.runtimeSettings === undefined) throw new Error('runtime snapshot missing');
        expect(Object.isFrozen(input.runtimeSettings)).toBe(true);
        runtimeDto.effectiveModel = IntexAgentModels.Gemini36Flash;
        expect(input.runtimeSettings.effectiveModel).toBe(IntexAgentModels.MiniMaxM3);
        return { outcome: 'no_action', reply: 'Okay.' };
      },
    };

    await handleIncomingMessage(
      message(),
      deps(repo, runner, replies, { now: () => NOW }, resolveRuntimeSettings)
    );

    expect(resolveRuntimeSettings).toHaveBeenCalledTimes(1);
  });

  it.each<{
    name: string;
    dto: IntexAgentRuntimeSettingsV1;
  }>([
    {
      name: 'explicit Gemini',
      dto: {
        status: 'available',
        effectiveModel: IntexAgentModels.Gemini36Flash,
        explicitModel: IntexAgentModels.Gemini36Flash,
        source: 'explicit',
        revision: 8,
        timeZone: 'Europe/Warsaw',
      },
    },
    {
      name: 'default-absent DeepSeek',
      dto: {
        status: 'available',
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        explicitModel: null,
        source: 'default_absent',
        revision: 0,
        timeZone: 'UTC',
      },
    },
    {
      name: 'unavailable platform-default DeepSeek',
      dto: {
        status: 'unavailable',
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        source: 'platform_default',
        timeZone: 'America/New_York',
      },
    },
  ])('uses the exact $name runtime DTO for the ordinary turn', async ({ dto }) => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const resolveRuntimeSettings = vi.fn(async () => ok(dto));
    const runner: IntexAgentRunner = {
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        throw new Error('not used');
      },
      async run(input): Promise<IntexAgentRunnerResult> {
        expect(input.runtimeSettings?.effectiveModel).toBe(dto.effectiveModel);
        expect(input.timeZone).toBe(dto.timeZone);
        return { outcome: 'no_action', reply: 'Okay.' };
      },
    };

    await handleIncomingMessage(
      message(),
      deps(repo, runner, replies, { now: () => NOW }, resolveRuntimeSettings)
    );

    expect(resolveRuntimeSettings).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-canonical model in an unavailable runtime snapshot', async () => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const runner = new FakeRunner([{ outcome: 'no_action', reply: 'must not run' }]);
    const invalid = {
      status: 'unavailable',
      effectiveModel: 'or:invalid/model',
      source: 'platform_default',
      timeZone: 'UTC',
    } as unknown as IntexAgentRuntimeSettingsV1;

    await expect(
      handleIncomingMessage(
        message(),
        deps(repo, runner, replies, { now: () => NOW }, async () => ok(invalid))
      )
    ).resolves.toEqual({ sessionId: 'session-1' });
    expect(runner.calls).toEqual([]);
    expect(replies.messages[0]?.message).toBe(
      'I could not process that request right now. Please restate what you want me to do.'
    );
  });

  it('keeps the image-with-source-url shortcut outside runtime resolution', async () => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const resolveRuntimeSettings = vi.fn(async () => {
      throw new Error('must not resolve');
    });
    const runner = new FakeRunner([
      {
        outcome: 'needs_confirmation',
        reply: 'Send image?',
        toolName: 'save_external',
        toolArgs: { message: 'Image', sourceUrl: 'https://example.test/image' },
      },
    ]);

    await handleIncomingMessage(
      message({ sourceType: 'whatsapp_image', sourceUrl: 'https://example.test/image' }),
      deps(repo, runner, replies, { now: () => NOW }, resolveRuntimeSettings)
    );

    expect(resolveRuntimeSettings).not.toHaveBeenCalled();
    expect(runner.calls).toHaveLength(1);
  });

  it('persists every staged operation in one confirmation request', async () => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const operations = [
      { toolName: 'update_calendar_event' as const, toolArgs: { eventId: 'event-1' } },
      { toolName: 'update_calendar_event' as const, toolArgs: { eventId: 'event-2' } },
    ];
    const runner = new FakeRunner([
      {
        outcome: 'needs_confirmation',
        reply: 'Apply 2 calendar event updates?',
        toolName: 'update_calendar_event',
        toolArgs: operations[0]?.toolArgs ?? {},
        operations,
      },
    ]);

    await handleIncomingMessage(message(), deps(repo, runner, replies));

    expect(eventPayloads(repo, 'confirmation_requested')[0]).toMatchObject({ operations });
  });

  it('turns runtime resolution failure into one localized fallback without running the provider', async () => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const runner = new FakeRunner([{ outcome: 'no_action', reply: 'must not run' }]);
    const logger = { warn: vi.fn() };
    const dependencies = deps(
      repo,
      runner,
      replies,
      { now: () => NOW },
      async () =>
        err({
          code: 'API_ERROR',
          message:
            'resolver-cause-sentinel raw-resolver-user-sentinel https://private.invalid/raw provider-sentinel model-sentinel',
        })
    );
    dependencies.logger = logger;

    await expect(handleIncomingMessage(message(), dependencies)).resolves.toEqual({
      sessionId: 'session-1',
    });

    expect(runner.calls).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { reason: 'runtime_settings_resolution_failed' },
      'Intex Agent runtime settings resolution failed'
    );
    expect(eventPayloads(repo, 'agent_fallback')).toEqual([
      { reason: 'runtime_resolution_failed', sourceOutcome: 'runtime_resolution' },
    ]);
    expect(eventPayloads(repo, 'clarification_requested')).toEqual([
      {
        message: 'I could not process that request right now. Please restate what you want me to do.',
        blockerReason: 'not_enough_context',
        suggestedNextStep: 'Ask the user to restate the action.',
        fallbackReason: 'runtime_resolution_failed',
      },
    ]);
    expect(replies.messages[0]?.message).toBe(
      'I could not process that request right now. Please restate what you want me to do.'
    );
    expect(repo.events.every((event) => event.userId === 'user-1')).toBe(true);
    expect(repo.events.every((event) => event.sessionId === 'session-1')).toBe(true);
    const privateOutput = JSON.stringify({
      payloads: repo.events.map((event) => event.payload),
      replies: replies.messages,
      logs: logger.warn.mock.calls,
    });
    expect(privateOutput).not.toMatch(
      /resolver-cause-sentinel|raw-resolver-user-sentinel|private\.invalid|provider-sentinel|model-sentinel/iu
    );
  });

  it.each(['NETWORK_ERROR', 'MALFORMED_RESPONSE', 'TIMEOUT'] as const)(
    'handles %s as the same private runtime-resolution outcome',
    async (code) => {
      const repo = new FakeSessionRepository();
      const replies = new FakeReplyPublisher();
      const runner = new FakeRunner([{ outcome: 'no_action', reply: 'must not run' }]);
      const logger = { warn: vi.fn() };
      const dependencies = deps(
        repo,
        runner,
        replies,
        { now: () => NOW },
        async () => err({ code, message: `private-${code}-cause` })
      );
      dependencies.logger = logger;

      await handleIncomingMessage(message(), dependencies);

      expect(runner.calls).toEqual([]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify({ events: repo.events, replies: replies.messages, logs: logger.warn.mock.calls }))
        .not.toContain(`private-${code}-cause`);
    }
  );

  it('uses the exact Polish runtime-resolution fallback from prior language context', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-prior',
      text: 'Zapisz notatkę.',
      sourceType: 'whatsapp_text',
    });
    const replies = new FakeReplyPublisher();
    const runner = new FakeRunner([{ outcome: 'no_action', reply: 'must not run' }]);

    await handleIncomingMessage(
      message({ messageId: 'wamid-current', text: 'i jeszcze jedną' }),
      deps(repo, runner, replies, { now: () => NOW }, async () =>
        err({ code: 'API_ERROR', message: 'private' })
      )
    );

    expect(replies.messages[0]?.message).toBe(
      'Nie mogłem teraz przetworzyć tej prośby. Napisz proszę jeszcze raz, co mam zrobić.'
    );
    expect(eventPayloads(repo, 'clarification_requested')[0]?.['suggestedNextStep']).toBe(
      'Poproś użytkownika o doprecyzowanie akcji.'
    );
  });

  it('creates a confirmation request for a note mutation and sends Yes/No buttons for English requests', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_confirmation',
        reply: 'Czy dodać notatkę?\n\nTytuł: Door code\nTreść: The door code is 1234.',
        summary: 'Saved door code note.',
        toolName: 'create_note',
        toolArgs: { title: 'Door code', content: 'The door code is 1234.' },
      },
    ]);
    const replies = new FakeReplyPublisher();

    const result = await handleIncomingMessage(message(), deps(repo, runner, replies));

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(repo.sessions[0]).toMatchObject({
      id: 'session-1',
      status: 'waiting_for_user',
      summary: 'Saved door code note.',
      activeTool: 'create_note',
    });
    expect(repo.sessions[0]?.endedAt).toBeUndefined();
    expect(repo.sessions[0]?.endReason).toBeUndefined();
    expect(eventTypes(repo)).toEqual([
      'session_started',
      'user_message',
      'confirmation_requested',
      'assistant_message',
    ]);
    expect(eventPayloads(repo, 'confirmation_requested')[0]).toEqual({
      confirmationId: 'confirmation-3',
      toolName: 'create_note',
      toolArgs: { title: 'Door code', content: 'The door code is 1234.' },
      message: 'Czy dodać notatkę?\n\nTytuł: Door code\nTreść: The door code is 1234.',
      sourceMessageId: 'wamid-1',
      summary: 'Saved door code note.',
    });
    expect(replies.messages).toEqual([
      {
        userId: 'user-1',
        message: 'Czy dodać notatkę?\n\nTytuł: Door code\nTreść: The door code is 1234.',
        replyToMessageId: 'wamid-1',
        correlationId: 'session-1',
        buttons: [
	          {
	            type: 'reply',
	            reply: {
	              id: 'intex_confirm:confirmation-3:yes',
	              title: 'Yes',
	            },
	          },
	          {
	            type: 'reply',
	            reply: {
	              id: 'intex_confirm:confirmation-3:no',
	              title: 'No',
	            },
	          },
        ],
      },
    ]);
  });

  it('persists supporting tool completions with and without selection metadata', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_confirmation',
        reply: 'Add this note?\nContent: Calendar follow-up',
        toolName: 'create_note',
        toolArgs: { content: 'Calendar follow-up' },
        supportingToolCompletions: [
          {
            toolName: 'query_calendar_events',
            result: { status: 'completed', mode: 'list', count: 0, truncated: false },
            toolSelection: { turnIndex: 0, ordinal: 1 },
          },
          {
            toolName: 'get_user_preferences',
            result: { status: 'completed', currentVersion: 0 },
          },
        ],
      },
    ]);

    await handleIncomingMessage(message(), deps(repo, runner, new FakeReplyPublisher()));

    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([
      {
        toolName: 'query_calendar_events',
        result: { status: 'completed', mode: 'list', count: 0, truncated: false },
        toolSelection: { turnIndex: 0, ordinal: 1 },
      },
      {
        toolName: 'get_user_preferences',
        result: { status: 'completed', currentVersion: 0 },
      },
    ]);
  });

  it('resolves and propagates the user IANA time zone to the runner', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([{ outcome: 'no_action', reply: 'Got it.' }]);
    const replies = new FakeReplyPublisher();
    const resolvedUserIds: string[] = [];

    await handleIncomingMessage(
      message(),
      deps(repo, runner, replies, { now: () => NOW }, async (userId) => {
        resolvedUserIds.push(userId);
        return ok({
          status: 'available',
          effectiveModel: IntexAgentModels.DeepSeekV4Flash,
          explicitModel: null,
          source: 'default_absent',
          revision: 0,
          timeZone: 'Europe/Warsaw',
        });
      })
    );

    expect(resolvedUserIds).toEqual(['user-1']);
    expect(runner.calls[0]).toMatchObject({
      currentDateTime: NOW,
      timeZone: 'Europe/Warsaw',
    });
  });

  it('sends Tak/Nie confirmation buttons for Polish requests', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_confirmation',
        reply: 'Czy dodać notatkę?\n\nTreść: Kod do drzwi to 1234.',
        toolName: 'create_note',
        toolArgs: { content: 'Kod do drzwi to 1234.' },
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'zapamiętaj że kod do drzwi to 1234' }),
      deps(repo, runner, replies)
    );

    expect(replies.messages[0]?.buttons).toEqual([
      {
        type: 'reply',
        reply: {
          id: 'intex_confirm:confirmation-3:yes',
          title: 'Tak',
        },
      },
      {
        type: 'reply',
        reply: {
          id: 'intex_confirm:confirmation-3:no',
          title: 'Nie',
        },
      },
    ]);
  });

  it('stores confirmation requests without optional summaries when the runner omits one', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_confirmation',
        reply: 'Czy dodać notatkę?\nTreść: The door code is 1234.',
        toolName: 'create_note',
        toolArgs: { content: 'The door code is 1234.' },
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(message(), deps(repo, runner, replies));

    expect(repo.sessions[0]).toMatchObject({
      id: 'session-1',
      status: 'waiting_for_user',
      activeTool: 'create_note',
    });
    expect(repo.sessions[0]?.summary).toBeUndefined();
    expect(eventPayloads(repo, 'confirmation_requested')[0]).toEqual({
      confirmationId: 'confirmation-3',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
      message: 'Czy dodać notatkę?\nTreść: The door code is 1234.',
      sourceMessageId: 'wamid-1',
    });
  });

  it('executes exactly stored confirmation args after a matching Tak button', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      lastAssistantMessageAt: '2026-06-24T09:51:00.000Z',
      startReason: 'no_active_session',
      activeTool: 'create_note',
    });
    repo.seedEvent('session-existing', 'confirmation_requested', {
      confirmationId: 'confirm-1',
      toolName: 'create_note',
      toolArgs: { title: 'Door code', content: 'The door code is 1234.' },
      message: 'Czy dodać notatkę?',
      sourceMessageId: 'wamid-original',
    });
    const runner = new FakeRunner([], [
      {
        outcome: 'completed',
        reply: 'Zapisałem notatkę.',
        toolName: 'create_note',
        toolResult: { status: 'completed', id: 'note-1' },
      },
    ]);
    const replies = new FakeReplyPublisher();
    const resolveRuntimeSettings = runtimeResolverSpy();

    const result = await handleIncomingMessage(
      message({
        messageId: 'wamid-button',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-1:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies, { now: () => NOW }, resolveRuntimeSettings)
    );

    expect(result).toEqual({ sessionId: 'session-existing' });
    expect(resolveRuntimeSettings).not.toHaveBeenCalled();
    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toHaveLength(1);
    expect(runner.executeConfirmedCalls[0]).toMatchObject({
      session: { id: 'session-existing' },
      toolName: 'create_note',
      toolArgs: { title: 'Door code', content: 'The door code is 1234.' },
      currentDateTime: NOW,
      messageId: 'wamid-button',
    });
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toMatchObject({
      confirmationId: 'confirm-1',
      resolution: 'accepted',
      buttonId: 'intex_confirm:confirm-1:yes',
    });
    expect(eventPayloads(repo, 'tool_call_completed')[0]).toEqual({
      toolName: 'create_note',
      result: { status: 'completed', id: 'note-1' },
    });
    expect(replies.messages).toEqual([
      {
        userId: 'user-1',
        message: 'Zapisałem notatkę.',
        replyToMessageId: 'wamid-button',
        correlationId: 'session-existing',
      },
    ]);
  });

  it('persists and executes typed code-task confirmation arguments from the real runner', async () => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const createCodeTaskCalls: Record<string, unknown>[] = [];
    const runner = createIntexAgentRunner({
      client: forcedCodeTaskToolClient({
        prompt: 'Investigate synthetic cache behavior.',
        workerType: 'openrouter-free',
      }),
      intentClassifier: {
        async classify() {
          return { kind: 'tool', allowedToolNames: ['create_code_task'] as const };
        },
      },
      toolExecutor: codeTaskCapturingExecutor(createCodeTaskCalls),
    });

    await handleIncomingMessage(
      message({
        messageId: 'wamid-code-task-request',
        text: 'Create a code task to investigate synthetic cache behavior.',
      }),
      deps(repo, runner, replies)
    );

    const canonicalArgs = {
      prompt: 'Investigate synthetic cache behavior.',
      taskMode: 'planning',
      workerType: 'openrouter-free',
    };
    expect(replies.messages[0]?.message).toBe(
      [
        'Create this code task?',
        '',
        'Prompt: Investigate synthetic cache behavior.',
        'Mode: planning',
        'Worker: openrouter-free',
      ].join('\n')
    );
    expect(eventPayloads(repo, 'confirmation_requested')[0]).toMatchObject({
      toolName: 'create_code_task',
      toolArgs: canonicalArgs,
    });
    expect(eventPayloads(repo, 'confirmation_requested')[0]?.['toolArgs']).toEqual(canonicalArgs);

    await handleIncomingMessage(
      message({
        messageId: 'wamid-code-task-confirmation',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirmation-3:yes',
          buttonTitle: 'Yes',
          replyToWamid: 'wamid-code-task-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(createCodeTaskCalls).toEqual([canonicalArgs]);
  });

  it('persists the exact calendar snapshot and uses it when the user confirms the attendee update', async () => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const updateCalendarCalls: Record<string, unknown>[] = [];
    const runner = createIntexAgentRunner({
      client: forcedCalendarAttendeeUpdateToolClient(),
      intentClassifier: {
        async classify() {
          return {
            kind: 'tool',
            allowedToolNames: ['query_calendar_events', 'update_calendar_event'] as const,
          };
        },
      },
      toolExecutor: calendarUpdateCapturingExecutor(updateCalendarCalls),
      toolSelectionGate: async ({ toolName }) => ({
        decision: 'allow',
        metadata: {
          turnIndex: 0,
          ordinal: toolName === 'query_calendar_events' ? 1 : 2,
        },
      }),
    });

    await handleIncomingMessage(
      message({
        messageId: 'wamid-calendar-update-request',
        text: 'Zaproś Patryka (patryk@example.com) na Bagrową jutro.',
      }),
      deps(repo, runner, replies, { now: () => NOW }, async () =>
        ok({
          status: 'available',
          effectiveModel: IntexAgentModels.DeepSeekV4Flash,
          explicitModel: null,
          source: 'default_absent',
          revision: 0,
          timeZone: 'Europe/Warsaw',
        })
      )
    );

    const canonicalArgs = {
      eventId: 'event-bagrowa',
      eventSummary: 'Bagrowa',
      attendeesToAdd: ['patryk@example.com'],
      calendarId: 'primary',
      expectedEtag: '"event-bagrowa-v1"',
      eventStart: { dateTime: '2026-06-25T18:00:00+02:00' },
      eventEnd: { dateTime: '2026-06-25T20:30:00+02:00' },
    };
    const supportingCompletion = eventPayloads(repo, 'tool_call_completed')[0];
    expect(supportingCompletion).toMatchObject({
      toolName: 'query_calendar_events',
      result: {
        status: 'completed',
        mode: 'list',
        count: 1,
        truncated: false,
      },
      toolSelection: { turnIndex: 0, ordinal: 1 },
    });
    const confirmationPayload = eventPayloads(repo, 'confirmation_requested')[0];
    expect(confirmationPayload?.['toolArgs']).toEqual(canonicalArgs);
    const confirmationId = confirmationPayload?.['confirmationId'];
    if (typeof confirmationId !== 'string') throw new Error('Expected confirmation id');
    expect(replies.messages[0]?.message).toContain('Początek: 25 czerwca 2026, 18:00');

    await handleIncomingMessage(
      message({
        messageId: 'wamid-calendar-update-confirmation',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: `intex_confirm:${confirmationId}:yes`,
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-calendar-update-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(updateCalendarCalls).toEqual([canonicalArgs]);
  });

  it('records a failed confirmed execution and does not reinterpret the request', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-1',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    const runner = new FakeRunner([], [
      {
        outcome: 'tool_failed',
        reply: 'Nie udało się wykonać tej akcji: downstream denied it. Spróbuj ponownie później.',
        toolName: 'create_note',
        error: 'downstream denied it',
        errorCategory: 'business',
        isRetryable: false,
        attemptedAction: 'create_note',
        toolSelection: { turnIndex: 1, ordinal: 1 },
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-button-failed',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-1:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toHaveLength(1);
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toMatchObject({
      confirmationId: 'confirm-1',
      resolution: 'accepted',
    });
    expect(eventPayloads(repo, 'tool_call_failed')[0]).toEqual({
      toolName: 'create_note',
      error: 'downstream denied it',
      errorCategory: 'business',
      isRetryable: false,
      attemptedAction: 'create_note',
      toolSelection: { turnIndex: 1, ordinal: 1 },
    });
    expect(replies.messages[0]?.message).toBe(
      'Nie udało się wykonać tej akcji: downstream denied it. Spróbuj ponownie później.'
    );
  });

  it('executes every individually staged operation after one confirmation', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-08-21T14:55:00.000Z',
      lastUserMessageAt: '2026-08-21T14:56:00.000Z',
      lastAssistantMessageAt: '2026-08-21T14:57:00.000Z',
      startReason: 'previous_expired',
      activeTool: 'update_calendar_event',
    });
    const operations = [
      {
        toolName: 'update_calendar_event' as const,
        toolSelection: { turnIndex: 2, ordinal: 1 },
        toolArgs: {
          eventId: 'event-2019',
          eventSummary: 'Google Photos od 04.2019',
          calendarId: 'primary',
          expectedEtag: '"event-2019-v1"',
          eventStart: {
            dateTime: '2026-08-13T19:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
          eventEnd: {
            dateTime: '2026-08-13T20:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
          changes: {
            start: { dateTime: '2026-08-22T19:00:00+02:00' },
            end: { dateTime: '2026-08-22T20:00:00+02:00' },
            attendeesToAdd: ['new@example.com'],
            attendeesToRemove: ['old@example.com'],
          },
        },
      },
      {
        toolName: 'update_calendar_event' as const,
        toolArgs: {
          eventId: 'event-2018',
          eventSummary: 'Wyczyścić Photos 2018',
          calendarId: 'primary',
          expectedEtag: '"event-2018-v1"',
          eventStart: { date: '2026-08-14' },
          eventEnd: { date: '2026-08-15' },
          changes: { start: { date: '2026-08-23' }, end: { date: '2026-08-24' } },
        },
      },
    ];
    repo.seedEvent('session-existing', 'confirmation_requested', {
      confirmationId: 'confirm-plan-1',
      operations,
      message: 'Przenieść dwa wydarzenia?',
      sourceMessageId: 'wamid-original',
    });
    const runner = new FakeRunner([], [{ outcome: 'completed', reply: 'Zaktualizowano 2 wydarzenia.' }]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-plan-confirmation',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-plan-1:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(runner.executeConfirmedCalls).toHaveLength(1);
    expect(runner.executeConfirmedCalls[0]).toMatchObject({ operations });
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toMatchObject({
      confirmationId: 'confirm-plan-1',
      resolution: 'accepted',
    });
    expect(replies.messages[0]?.message).toBe('Zaktualizowano 2 wydarzenia.');
  });

  it('records completed and failed operations from one confirmed plan separately', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-plan-results',
      toolName: 'update_calendar_event',
      toolArgs: { eventId: 'event-1' },
      operations: [
        calendarUpdateOperation('event-1'),
        calendarUpdateOperation('event-2'),
        calendarUpdateOperation('event-3'),
        calendarUpdateOperation('event-4'),
      ],
    });
    const runner = new FakeRunner([], [
      {
        outcome: 'completed',
        reply: 'Zaktualizowano 1 z 2 wydarzeń w kalendarzu.',
        operationResults: [
          {
            toolName: 'update_calendar_event',
            status: 'completed',
            toolResult: { eventId: 'event-1' },
          },
          {
            toolName: 'update_calendar_event',
            status: 'failed',
            error: 'event changed',
          },
          {
            toolName: 'update_calendar_event',
            status: 'completed',
          },
          {
            toolName: 'update_calendar_event',
            status: 'failed',
          },
        ],
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-plan-results',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-plan-results:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'tool_call_completed')).toContainEqual({
      toolName: 'update_calendar_event',
      result: { eventId: 'event-1' },
    });
    expect(eventPayloads(repo, 'tool_call_failed')).toContainEqual({
      toolName: 'update_calendar_event',
      error: 'event changed',
    });
    expect(eventPayloads(repo, 'tool_call_completed')).toContainEqual({
      toolName: 'update_calendar_event',
    });
    expect(eventPayloads(repo, 'tool_call_failed')).toContainEqual({
      toolName: 'update_calendar_event',
      error: 'Unknown tool execution error',
    });
    expect(replies.messages[0]?.message).toBe('Zaktualizowano 1 z 2 wydarzeń w kalendarzu.');
  });

  it.each<{ name: string; operations: unknown }>([
    { name: 'a non-array value', operations: { toolName: 'update_calendar_event' } },
    { name: 'an empty batch', operations: [] },
    { name: 'a one-operation batch', operations: [calendarUpdateOperation('event-1')] },
    {
      name: 'a batch above the operation limit',
      operations: Array.from({ length: 21 }, (_, index) =>
        calendarUpdateOperation(`event-${String(index + 1)}`)
      ),
    },
    { name: 'a non-object operation', operations: [null, calendarUpdateOperation('event-2')] },
    {
      name: 'an operation for a non-update tool',
      operations: [
        { toolName: 'create_note', toolArgs: { content: 'Do not execute this.' } },
        calendarUpdateOperation('event-2'),
      ],
    },
    {
      name: 'duplicate event IDs',
      operations: [calendarUpdateOperation('event-1'), calendarUpdateOperation('event-1')],
    },
    {
      name: 'an operation with an incomplete event snapshot',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            expectedEtag: undefined,
          },
        },
      ],
    },
    {
      name: 'an operation with a non-object event date-time',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            eventStart: null,
          },
        },
      ],
    },
    {
      name: 'an operation with an unknown event date-time field',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            eventStart: { date: '2026-08-13', unsupported: true },
          },
        },
      ],
    },
    {
      name: 'an operation with a schema-invalid event date-time',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            eventStart: { date: 42 },
          },
        },
      ],
    },
    {
      name: 'an operation with both event date forms',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            eventStart: {
              date: '2026-08-13',
              dateTime: '2026-08-13T19:00:00+02:00',
            },
          },
        },
      ],
    },
    {
      name: 'an operation with a blank event time zone',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            eventStart: { date: '2026-08-13', timeZone: ' ' },
          },
        },
      ],
    },
    {
      name: 'an operation with empty changes',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: { ...calendarUpdateOperation('event-2').toolArgs, changes: {} },
        },
      ],
    },
    {
      name: 'an operation with non-object changes',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: { ...calendarUpdateOperation('event-2').toolArgs, changes: null },
        },
      ],
    },
    {
      name: 'an operation with an unpaired temporal change',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            changes: { start: { date: '2026-08-22' } },
          },
        },
      ],
    },
    {
      name: 'an operation with an invalid attendee email',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            changes: { attendeesToAdd: ['not-an-email'] },
          },
        },
      ],
    },
    {
      name: 'an operation with a non-array attendee addition',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            changes: { attendeesToAdd: 'not-an-array' },
          },
        },
      ],
    },
    {
      name: 'an operation with a non-array attendee removal',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            changes: { attendeesToRemove: 'not-an-array' },
          },
        },
      ],
    },
    {
      name: 'an operation with a non-object tool selection',
      operations: [
        calendarUpdateOperation('event-1'),
        { ...calendarUpdateOperation('event-2'), toolSelection: null },
      ],
    },
    {
      name: 'an operation with an unknown tool selection field',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolSelection: { turnIndex: 2, ordinal: 1, unsupported: true },
        },
      ],
    },
    ...[
      { name: 'a non-numeric selection turn', toolSelection: { turnIndex: '2', ordinal: 1 } },
      { name: 'a fractional selection turn', toolSelection: { turnIndex: 2.5, ordinal: 1 } },
      { name: 'a negative selection turn', toolSelection: { turnIndex: -1, ordinal: 1 } },
      { name: 'a non-numeric selection ordinal', toolSelection: { turnIndex: 2, ordinal: '1' } },
      { name: 'a fractional selection ordinal', toolSelection: { turnIndex: 2, ordinal: 1.5 } },
      { name: 'a zero selection ordinal', toolSelection: { turnIndex: 2, ordinal: 0 } },
    ].map(({ name, toolSelection }) => ({
      name: `an operation with ${name}`,
      operations: [
        calendarUpdateOperation('event-1'),
        { ...calendarUpdateOperation('event-2'), toolSelection },
      ],
    })),
    {
      name: 'an operation with an unknown argument',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            unconfirmedField: 'must not execute',
          },
        },
      ],
    },
    {
      name: 'an operation with an unknown nested change',
      operations: [
        calendarUpdateOperation('event-1'),
        {
          ...calendarUpdateOperation('event-2'),
          toolArgs: {
            ...calendarUpdateOperation('event-2').toolArgs,
            changes: { summary: 'Updated event-2', unsupported: true },
          },
        },
      ],
    },
  ])('invalidates a stored confirmation when operations contain $name', async ({ operations }) => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-malformed-operations',
      toolName: 'create_note',
      toolArgs: { content: 'Keep the legacy action.' },
    });
    const confirmation = eventPayloads(repo, 'confirmation_requested')[0];
    if (confirmation === undefined) throw new Error('Expected seeded confirmation');
    confirmation['operations'] = operations;
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-malformed-operations',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-malformed-operations:yes',
          buttonTitle: 'Yes',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(eventPayloads(repo, 'confirmation_resolved')).toEqual([]);
    expect(replies.messages[0]?.message).toBe(
      'This confirmation is no longer current. Send the request again.'
    );
  });

  it('records a failed confirmed execution without optional failure metadata', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-1',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    const runner = new FakeRunner([], [
      {
        outcome: 'tool_failed',
        reply: 'I could not complete that action.',
        toolName: 'create_note',
        error: 'downstream denied it',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-button-failed-minimal',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-1:yes',
          buttonTitle: 'Yes',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'tool_call_failed')[0]).toEqual({
      toolName: 'create_note',
      error: 'downstream denied it',
    });
    expect(replies.messages[0]?.message).toBe('I could not complete that action.');
  });

  it('rejects a pending confirmation after a matching Nie button', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-1',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();
    const resolveRuntimeSettings = runtimeResolverSpy();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-button-no',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-1:no',
          buttonTitle: 'Nie',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies, { now: () => NOW }, resolveRuntimeSettings)
    );

    expect(runner.calls).toEqual([]);
    expect(resolveRuntimeSettings).not.toHaveBeenCalled();
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toMatchObject({
      confirmationId: 'confirm-1',
      resolution: 'rejected',
    });
    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
    expect(replies.messages[0]?.message).toBe('Okej, nie wykonuję tej akcji.');
  });

  it('rejects confirmation buttons when no active session exists', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();
    const resolveRuntimeSettings = runtimeResolverSpy();

    const result = await handleIncomingMessage(
      message({
        messageId: 'wamid-button-without-session',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-1:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies, { now: () => NOW }, resolveRuntimeSettings)
    );

    expect(result).toEqual({ sessionId: 'wamid-button-without-session' });
    expect(resolveRuntimeSettings).not.toHaveBeenCalled();
    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(repo.events).toEqual([]);
    expect(replies.messages).toEqual([
      {
        userId: 'user-1',
        message: 'To potwierdzenie nie jest już aktualne. Wyślij prośbę jeszcze raz.',
        replyToMessageId: 'wamid-button-without-session',
        correlationId: 'wamid-button-without-session',
      },
    ]);
  });

  it.each([
    { buttonTitle: 'Yes', expectedReply: 'This confirmation is no longer current. Send the request again.' },
    { buttonTitle: 'Maybe', expectedReply: 'This confirmation is no longer current. Send the request again.' },
  ])(
    'uses the fallback language for a $buttonTitle confirmation button without an active session',
    async ({ buttonTitle, expectedReply }) => {
      const repo = new FakeSessionRepository();
      const runner = new FakeRunner([]);
      const replies = new FakeReplyPublisher();

      await handleIncomingMessage(
        message({
          messageId: `wamid-button-without-session-${buttonTitle}`,
          text: '',
          sourceType: 'whatsapp_button',
          buttonResponse: {
            buttonId: 'intex_confirm:confirm-1:yes',
            buttonTitle,
            replyToWamid: 'wamid-confirmation-message',
          },
        }),
        deps(repo, runner, replies)
      );

      expect(runner.calls).toEqual([]);
      expect(runner.executeConfirmedCalls).toEqual([]);
      expect(replies.messages[0]?.message).toBe(expectedReply);
    }
  );

  it('does not execute stale or mismatched confirmation buttons', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-current',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-stale-button',
        text: '',
        sourceType: 'whatsapp_button',
        sourceUrl: 'https://storage.example.com/signed/whatsapp/user-1/wamid-button/media.jpg',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-old:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(eventPayloads(repo, 'confirmation_resolved')).toEqual([]);
    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
    expect(replies.messages[0]?.message).toBe(
      'To potwierdzenie nie jest już aktualne. Wyślij prośbę jeszcze raz.'
    );
  });

  it('ignores historical attachment-only messages when selecting stale confirmation language', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-1',
      toolName: 'create_note',
      toolArgs: { content: 'Door code is 1234.' },
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-polish',
      text: 'Zapamiętaj, że wolę krótkie odpowiedzi.',
      sourceType: 'whatsapp_text',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-attachment',
      text: 'Attachment shared via WhatsApp.',
      sourceType: 'whatsapp_document',
      hasSourceUrl: true,
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-stale-button',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-2:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(replies.messages[0]?.message).toBe(
      'To potwierdzenie nie jest już aktualne. Wyślij prośbę jeszcze raz.'
    );
  });

  it('does not execute malformed structured button messages', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-current',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-button-missing-payload',
        text: '',
        sourceType: 'whatsapp_button',
      }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(eventPayloads(repo, 'user_message').at(-1)).toEqual({
      messageId: 'wamid-button-missing-payload',
      text: '',
      sourceType: 'whatsapp_button',
    });
    expect(replies.messages[0]?.message).toBe(
      'This confirmation is no longer current. Send the request again.'
    );
  });

  it('does not execute structured button messages with malformed confirmation IDs', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-current',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-button-malformed-id',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-current:maybe',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(replies.messages[0]?.message).toBe(
      'To potwierdzenie nie jest już aktualne. Wyślij prośbę jeszcze raz.'
    );
  });

  it('does not execute already resolved or malformed pending confirmation events', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-current',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    repo.seedEvent('session-existing', 'confirmation_resolved', {
      confirmationId: 123,
      resolution: 'ignored-malformed-id',
    });
    repo.seedEvent('session-existing', 'confirmation_requested', {
      confirmationId: 'confirm-invalid-tool',
      toolName: 'query_calendar_events',
      toolArgs: { mode: 'list' },
      message: 'Invalid read-only pending confirmation.',
      sourceMessageId: 'wamid-invalid-tool',
    });
    repo.seedEvent('session-existing', 'confirmation_requested', {
      confirmationId: 'confirm-invalid-args',
      toolName: 'create_note',
      toolArgs: [],
      message: 'Invalid args pending confirmation.',
      sourceMessageId: 'wamid-invalid-args',
    });
    repo.seedEvent('session-existing', 'confirmation_resolved', {
      confirmationId: 'confirm-current',
      resolution: 'rejected',
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-resolved-button',
        text: '',
        sourceType: 'whatsapp_button',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-current:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(replies.messages[0]?.message).toBe(
      'To potwierdzenie nie jest już aktualne. Wyślij prośbę jeszcze raz.'
    );
  });

  it('executes a pending four-event confirmation when the user replies with plain text Tak', async () => {
    const repo = new FakeSessionRepository();
    const operations = [
      calendarUpdateOperation('event-1'),
      calendarUpdateOperation('event-2'),
      calendarUpdateOperation('event-3'),
      calendarUpdateOperation('event-4'),
    ];
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-1',
      toolName: 'update_calendar_event',
      toolArgs: operations[0]?.toolArgs ?? {},
      operations,
    });
    const runner = new FakeRunner([], [
      {
        outcome: 'completed',
        reply: 'Zaktualizowano 4 z 4 wydarzeń w kalendarzu.',
        operationResults: operations.map(() => ({
          toolName: 'update_calendar_event' as const,
          status: 'completed' as const,
        })),
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-text-tak', text: 'tak', sourceType: 'whatsapp_text' }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toHaveLength(1);
    expect(runner.executeConfirmedCalls[0]).toMatchObject({ operations });
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toEqual({
      confirmationId: 'confirm-1',
      resolution: 'accepted',
    });
    expect(eventPayloads(repo, 'tool_call_completed')).toHaveLength(4);
    expect(replies.messages[0]?.message).toBe(
      'Zaktualizowano 4 z 4 wydarzeń w kalendarzu.'
    );
  });

  it('rejects a pending confirmation when the user replies with plain text Nie', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-text-no',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    repo.seedEvent('session-existing', 'assistant_message', {
      text: 'Czy wykonać tę akcję?',
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-text-nie', text: 'Nie.', sourceType: 'whatsapp_text' }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toEqual({
      confirmationId: 'confirm-text-no',
      resolution: 'rejected',
    });
    expect(replies.messages[0]?.message).toBe('Okay, I will not run this action.');
  });

  it('does not let plain text Tak fall back from a malformed latest confirmation to older operations', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-old',
      toolName: 'create_note',
      toolArgs: { content: 'Older action must not execute.' },
    });
    repo.seedEvent('session-existing', 'confirmation_requested', {
      confirmationId: 'confirm-new-malformed',
      operations: [calendarUpdateOperation('event-new')],
      message: 'Malformed newer confirmation.',
      sourceMessageId: 'wamid-newer-confirmation',
    });
    const runner = new FakeRunner([
      { outcome: 'no_action', reply: 'Potwierdzenie nie zostało wykonane.' },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-text-tak-malformed', text: 'Tak', sourceType: 'whatsapp_text' }),
      deps(repo, runner, replies)
    );

    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(runner.calls).toHaveLength(1);
    expect(replies.messages[0]?.message).toBe('Potwierdzenie nie zostało wykonane.');
  });

  it('supersedes a pending confirmation when a new text request arrives', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-1',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Masz jedno wydarzenie jutro.',
        toolName: 'query_calendar_events',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-new-text',
        text: 'Jakie wydarzenia mam zaplanowane na jutro?',
        sourceType: 'whatsapp_text',
      }),
      deps(repo, runner, replies)
    );

    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toEqual({
      confirmationId: 'confirm-1',
      resolution: 'superseded',
    });
    expect(eventPayloads(repo, 'tool_call_completed')[0]).toEqual({
      toolName: 'query_calendar_events',
    });
    expect(replies.messages[0]?.message).toBe('Masz jedno wydarzenie jutro.');
  });

  it('passes only prior events to the runner after storing the current user message', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:55:00.000Z',
      lastUserMessageAt: '2026-06-24T09:55:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-previous',
      text: 'create event tomorrow',
      sourceType: 'whatsapp_text',
    });
    const runner = new FakeRunner([
      {
        outcome: 'no_action',
        reply: 'Cześć! U mnie wszystko w porządku. W czym mogę pomóc?',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-current', text: 'remember that the door code is 1234' }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'user_message')).toEqual([
      {
        messageId: 'wamid-previous',
        text: 'create event tomorrow',
        sourceType: 'whatsapp_text',
      },
      {
        messageId: 'wamid-current',
        text: 'remember that the door code is 1234',
        sourceType: 'whatsapp_text',
      },
    ]);
    expect(runner.calls).toHaveLength(1);
    const call = runner.calls[0];
    if (call === undefined) {
      throw new Error('Expected runner call');
    }
    expect(call.message).toBe('remember that the door code is 1234');
    expect(call.events.map((event) => event.payload['messageId'])).toEqual(['wamid-previous']);
  });

  it('stores and passes replied-message context for the current user message', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'no_action',
        reply: 'Cześć! U mnie wszystko w porządku. W czym mogę pomóc?',
      },
    ]);
    const replies = new FakeReplyPublisher();
    const replyContext = {
      replyToWamid: 'wamid-original',
      source: 'outbound_assistant_message' as const,
      text: 'What would you like me to help with?',
      truncated: false,
    };

    await handleIncomingMessage(
      message({
        messageId: 'wamid-current',
        text: 'show tomorrow calendar events',
        replyContext,
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'user_message')[0]).toEqual({
      messageId: 'wamid-current',
      text: 'show tomorrow calendar events',
      sourceType: 'whatsapp_text',
      replyContext,
    });
    expect(runner.calls).toHaveLength(1);
    const call = runner.calls[0];
    if (call === undefined) {
      throw new Error('Expected runner call');
    }
    expect(call.message).toBe('show tomorrow calendar events');
    expect(call.replyContext).toEqual(replyContext);
    expect(call.events.some((event) => event.payload['messageId'] === 'wamid-current')).toBe(false);
  });

  it('stores unexpected button metadata on non-button messages without treating it as approval', async () => {
    const repo = new FakeSessionRepository();
    seedPendingConfirmation(repo, {
      confirmationId: 'confirm-1',
      toolName: 'create_note',
      toolArgs: { content: 'The door code is 1234.' },
    });
    const runner = new FakeRunner([
      {
        outcome: 'no_action',
        reply: 'Nie wykonuję żadnej akcji bez przycisku potwierdzenia.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-text-with-button-payload',
        text: 'tak',
        sourceType: 'whatsapp_text',
        buttonResponse: {
          buttonId: 'intex_confirm:confirm-1:yes',
          buttonTitle: 'Tak',
          replyToWamid: 'wamid-confirmation-message',
        },
      }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toHaveLength(1);
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(eventPayloads(repo, 'user_message').at(-1)).toEqual({
      messageId: 'wamid-text-with-button-payload',
      text: 'tak',
      sourceType: 'whatsapp_text',
      buttonResponse: {
        buttonId: 'intex_confirm:confirm-1:yes',
        buttonTitle: 'Tak',
        replyToWamid: 'wamid-confirmation-message',
      },
    });
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toEqual({
      confirmationId: 'confirm-1',
      resolution: 'superseded',
    });
  });

  it('passes source URLs to the runner without storing the full URL in session events', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Saved externally',
        toolName: 'save_external',
        toolResult: { status: 'completed', message: 'Saved externally' },
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-image',
        text: '',
        sourceType: 'whatsapp_image',
        sourceUrl: 'https://storage.example.com/signed/whatsapp/user-1/wamid-image/media.jpg',
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'user_message')[0]).toEqual({
      messageId: 'wamid-image',
      text: '',
      sourceType: 'whatsapp_image',
      hasSourceUrl: true,
    });
    expect(runner.calls[0]).toMatchObject({
      message: '',
      sourceType: 'whatsapp_image',
      sourceUrl: 'https://storage.example.com/signed/whatsapp/user-1/wamid-image/media.jpg',
    });
  });

  it('keeps greeting sessions open without publishing lifecycle text', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'no_action',
        reply: 'Cześć! U mnie wszystko w porządku. W czym mogę pomóc?',
      },
    ]);
    const replies = new FakeReplyPublisher();

    const result = await handleIncomingMessage(
      message({ text: 'Cześć! Co u Ciebie?' }),
      deps(repo, runner, replies)
    );

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(repo.sessions[0]).toMatchObject({
      id: 'session-1',
      status: 'waiting_for_user',
      startReason: 'no_active_session',
    });
    expect(repo.sessions[0]?.endedAt).toBeUndefined();
    expect(repo.sessions[0]?.endReason).toBeUndefined();
    expect(eventTypes(repo)).toEqual([
      'session_started',
      'user_message',
      'assistant_message',
    ]);
    expect(replies.messages).toEqual([
      {
        userId: 'user-1',
        message: 'Cześć! U mnie wszystko w porządku. W czym mogę pomóc?',
        replyToMessageId: 'wamid-1',
        correlationId: 'session-1',
      },
    ]);
  });

  it('publishes completed runner CTA URLs when the tool result includes one', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Zapisałem notatkę.',
        toolName: 'create_note',
        toolResult: { status: 'completed', id: 'note-1' },
        ctaUrl: {
          displayText: 'Open note',
          url: 'https://intexuraos.cloud/#/notes/note-1',
        },
        toolSelection: { turnIndex: 0, ordinal: 1 },
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'remember that the door code is 1234' }),
      deps(repo, runner, replies)
    );

    expect(replies.messages[0]).toMatchObject({
      message: 'Zapisałem notatkę.',
      ctaUrl: {
        displayText: 'Open note',
        url: 'https://intexuraos.cloud/#/notes/note-1',
      },
    });
    expect(eventPayloads(repo, 'tool_call_completed')[0]).toMatchObject({
      toolSelection: { turnIndex: 0, ordinal: 1 },
    });
  });

  it('fails closed when a proposal-phase runner claims it already created a calendar event', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Created the calendar event.',
        toolName: 'create_calendar_event',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'create a dentist appointment tomorrow 9-10am' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]?.status).toBe('waiting_for_user');
    expect(repo.sessions[0]?.activeTool).toBeUndefined();
    expect(repo.sessions[0]?.summary).toBeUndefined();
    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
    expect(eventPayloads(repo, 'clarification_requested')[0]).toMatchObject({
      blockerReason: 'not_enough_context',
      candidateIntents: ['create_calendar_event'],
      fallbackReason: 'tool_result_mismatch',
    });
    expect(replies.messages[0]?.message).toContain(
      'I could not safely prepare the calendar event for confirmation.'
    );
  });

  it('localizes a proposal-phase calendar execution bypass in Polish', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Utworzyłem wydarzenie.',
        toolName: 'create_calendar_event',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'Dodaj wizytę u dentysty jutro od 9:00 do 10:00.' }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'clarification_requested')[0]).toMatchObject({
      suggestedNextStep: 'Podaj ponownie tytuł, datę, początek i koniec wydarzenia.',
    });
    expect(replies.messages[0]?.message).toContain(
      'Nie udało mi się bezpiecznie przygotować wydarzenia do potwierdzenia.'
    );
  });

  it('asks what to do next after completing a preference delete', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Usunięte.',
        toolName: 'delete_user_preference',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'Usuń tę preferencję' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]).toMatchObject({
      status: 'waiting_for_user',
    });
    expect(repo.sessions[0]?.activeTool).toBeUndefined();
    expect(replies.messages[0]?.message).toBe('Usunięte. Co mogę teraz dla Ciebie zrobić?');
  });

  it('does not duplicate the follow-up prompt when a completed preference reply already asks a question', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Usunięte. Co mogę teraz dla Ciebie zrobić?',
        toolName: 'delete_user_preference',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'Usuń tę preferencję' }),
      deps(repo, runner, replies)
    );

    expect(replies.messages[0]?.message).toBe('Usunięte. Co mogę teraz dla Ciebie zrobić?');
  });

  it('passes the deterministic clock value to the runner', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'You have one event next week.',
        toolName: 'query_calendar_events',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'What are my events scheduled for next week?' }),
      deps(repo, runner, replies, { now: () => '2026-06-26T17:00:00.000Z' })
    );

    expect(runner.calls[0]).toMatchObject({
      message: 'What are my events scheduled for next week?',
      currentDateTime: '2026-06-26T17:00:00.000Z',
    });
  });

  it('asks for clarification and keeps the session waiting when a calendar date is missing', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_clarification',
        reply: 'New session started.\n\nWhich day should I schedule it for?',
        blockerReason: 'missing_required_details',
        missingFields: ['date'],
        candidateIntents: ['create_calendar_event'],
        suggestedNextStep: 'Ask for the missing calendar date.',
        clarification: 'Which day should I schedule it for?',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'create a calendar event for a dentist appointment at 9am' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]?.status).toBe('waiting_for_user');
    expect(eventTypes(repo)).toEqual([
      'session_started',
      'user_message',
      'clarification_requested',
      'assistant_message',
    ]);
    expect(eventPayloads(repo, 'clarification_requested')[0]).toEqual({
      message: 'Which day should I schedule it for?',
      blockerReason: 'missing_required_details',
      missingFields: ['date'],
      candidateIntents: ['create_calendar_event'],
      suggestedNextStep: 'Ask for the missing calendar date.',
      clarification: 'Which day should I schedule it for?',
    });
    expect(replies.messages[0]?.message).toBe('Which day should I schedule it for?');
  });

  it('persists a calendar draft without buttons before publishing a separate exact confirmation', async () => {
    const repo = new FakeSessionRepository();
    const draft = {
      version: 1 as const,
      toolArgs: {
        summary: 'Turniej OPEN B++',
        start: '2026-08-14T18:00:00+02:00',
        end: '2026-08-14T19:00:00+02:00',
        timeZone: 'Europe/Warsaw',
      },
      fields: {
        summary: {
          value: 'Turniej OPEN B++',
          status: 'user_confirmed' as const,
          source: 'user_message' as const,
        },
        start: {
          value: '2026-08-14T18:00:00+02:00',
          status: 'user_confirmed' as const,
          source: 'user_message' as const,
        },
        end: {
          value: '2026-08-14T19:00:00+02:00',
          status: 'proposed_default' as const,
          source: 'safe_default' as const,
        },
        timeZone: {
          value: 'Europe/Warsaw',
          status: 'runtime_default' as const,
          source: 'runtime' as const,
        },
      },
      omittedFields: ['location', 'description', 'attendees'],
    };
    const clarification =
      'Widzę: „Turniej OPEN B++”, 14.08.2026, start 18:00. Lokalizację mogę pominąć. Nie znam czasu zakończenia — mogę przyjąć 60 minut, czyli do 19:00. Pasuje?';
    const confirmation =
      'Czy dodać wydarzenie w kalendarzu?\n\nTytuł: Turniej OPEN B++\nPoczątek: 14 sierpnia 2026, 18:00\nKoniec: 14 sierpnia 2026, 19:00';
    const runner = new FakeRunner([
      {
        outcome: 'needs_clarification',
        reply: clarification,
        clarification,
        blockerReason: 'missing_required_details',
        missingFields: ['end'],
        candidateIntents: ['create_calendar_event'],
        suggestedNextStep: 'Potwierdź domyślny czas albo podaj inną godzinę końca.',
        calendarEventDraft: draft,
        toolSelection: { turnIndex: 0, ordinal: 1 },
      },
      {
        outcome: 'needs_confirmation',
        reply: confirmation,
        toolName: 'create_calendar_event',
        toolArgs: draft.toolArgs,
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-calendar-draft',
        text: 'Dodaj Turniej OPEN B++ 14 sierpnia 2026 o 18:00 do mojego kalendarza.',
      }),
      deps(repo, runner, replies)
    );
    await handleIncomingMessage(
      message({
        messageId: 'wamid-calendar-default-accepted',
        text: 'Tak',
        timestamp: '2026-06-24T10:01:00.000Z',
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'clarification_requested')[0]).toMatchObject({
      message: clarification,
      missingFields: ['end'],
      calendarEventDraft: draft,
      toolSelection: { turnIndex: 0, ordinal: 1 },
    });
    expect(eventPayloads(repo, 'confirmation_requested')[0]).toMatchObject({
      toolName: 'create_calendar_event',
      toolArgs: draft.toolArgs,
    });
    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
    expect(replies.messages[0]).not.toHaveProperty('buttons');
    expect(replies.messages[1]?.buttons).toHaveLength(2);
  });

  it('records clarification requests without optional metadata when the runner omits it', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_clarification',
        reply: 'Which action did you mean?',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'make it happen' }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'clarification_requested')[0]).toEqual({
      message: 'Which action did you mean?',
    });
    expect(replies.messages[0]?.message).toBe('Which action did you mean?');
  });

  it('continues a waiting session when the user answers a clarification', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      lastAssistantMessageAt: '2026-06-24T09:51:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      text: 'create a calendar event for dentist at 9am',
    });
    repo.seedEvent('session-existing', 'clarification_requested', {
      message: 'Which day should I schedule it for?',
    });
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Scheduled it for tomorrow.',
        summary: 'Created dentist appointment.',
        toolName: 'create_calendar_event',
        toolSelection: { turnIndex: 0, ordinal: 1 },
      },
    ]);
    const replies = new FakeReplyPublisher();

    const result = await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'tomorrow' }),
      deps(repo, runner, replies)
    );

    expect(result).toEqual({ sessionId: 'session-existing' });
    expect(repo.sessions[0]?.status).toBe('waiting_for_user');
    expect(repo.createdSessions).toHaveLength(0);
    expect(runner.calls[0]?.session.id).toBe('session-existing');
    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
    expect(eventPayloads(repo, 'clarification_requested').at(-1)).toMatchObject({
      blockerReason: 'not_enough_context',
      candidateIntents: ['create_calendar_event'],
    });
    expect(replies.messages[0]?.message).toContain(
      'I could not safely prepare the calendar event for confirmation.'
    );
  });

  it('replies unsupported and keeps the session available for follow-up context', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'unsupported',
        reply: 'I do not support that yet. I can create notes and calendar events.',
        blockerReason: 'unsupported_capability',
        missingFields: ['supported_action'],
        candidateIntents: ['create_note'],
        suggestedNextStep: 'Offer to save the flight details as a note.',
        fallbackReason: 'runner_declared_unsupported',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'book me a flight to Lisbon' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]?.status).toBe('waiting_for_user');
    expect(repo.sessions[0]?.endedAt).toBeUndefined();
    expect(repo.sessions[0]?.endReason).toBeUndefined();
    expect(repo.sessions[0]?.summary).toBe('book me a flight to Lisbon');
    expect(eventTypes(repo)).toEqual([
      'session_started',
      'user_message',
      'agent_fallback',
      'unsupported_request',
      'assistant_message',
    ]);
    expect(eventPayloads(repo, 'agent_fallback')[0]).toEqual({
      reason: 'runner_declared_unsupported',
      sourceOutcome: 'unsupported',
    });
    expect(eventPayloads(repo, 'unsupported_request')[0]).toEqual({
      message: 'I do not support that yet. I can create notes and calendar events.',
      blockerReason: 'unsupported_capability',
      missingFields: ['supported_action'],
      candidateIntents: ['create_note'],
      suggestedNextStep: 'Offer to save the flight details as a note.',
      fallbackReason: 'runner_declared_unsupported',
    });
    expect(replies.messages[0]?.message).toBe(
      'I do not support that yet. I can create notes and calendar events.'
    );
  });

  it('truncates unsupported session summaries from long user messages', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'unsupported',
        reply: 'I can only create notes and calendar events.',
        blockerReason: 'unsupported_capability',
        suggestedNextStep: 'I can save the details as a note.',
        fallbackReason: 'runner_declared_unsupported',
      },
    ]);
    const replies = new FakeReplyPublisher();
    const longText = 'What are events in my calendar tomorrow and which ones conflict with preparation time';
    const repeatedText = `${longText} ${longText}`;

    await handleIncomingMessage(
      message({ text: repeatedText }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]?.summary).toBe(`${repeatedText.slice(0, 117)}...`);
  });

  it('normalizes WhatsApp epoch-second timestamps and records fresh event timestamps', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'unsupported',
        reply: 'I can only create notes and calendar events.',
        blockerReason: 'unsupported_capability',
        suggestedNextStep: 'I can save the details as a note.',
        fallbackReason: 'runner_declared_unsupported',
      },
    ]);
    const replies = new FakeReplyPublisher();
    const clock = new SequenceClock([
      '2026-06-24T16:10:19.000Z',
      '2026-06-24T16:10:19.001Z',
      '2026-06-24T16:10:19.002Z',
      '2026-06-24T16:10:20.000Z',
      '2026-06-24T16:10:20.001Z',
      '2026-06-24T16:10:20.002Z',
      '2026-06-24T16:10:20.003Z',
    ]);

    await handleIncomingMessage(
      message({
        timestamp: '1782317416',
        text: 'What are events in my calendar tomorrow?',
      }),
      deps(repo, runner, replies, clock)
    );

    expect(repo.sessions[0]?.lastUserMessageAt).toBe('2026-06-24T16:10:16.000Z');
    expect(new Set(repo.events.map((event) => event.createdAt)).size).toBe(repo.events.length);
  });

  it('supersedes an open session and starts an idle one for an explicit new-session command', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();
    const resolveRuntimeSettings = runtimeResolverSpy();

    const result = await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'new session' }),
      deps(repo, runner, replies, { now: () => NOW }, resolveRuntimeSettings)
    );

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(repo.sessions).toMatchObject([
      {
        id: 'session-existing',
        status: 'superseded',
        endReason: 'superseded_by_user',
      },
      {
        id: 'session-1',
        status: 'waiting_for_user',
        startReason: 'user_requested_new_session',
      },
    ]);
    expect(eventTypes(repo)).toEqual([
      'session_closed',
      'session_started',
      'assistant_message',
    ]);
    expect(runner.calls).toEqual([]);
    expect(resolveRuntimeSettings).not.toHaveBeenCalled();
    expect(replies.messages[0]?.message).toBe(NEW_SESSION_READY_REPLY);
  });

  it('uses prior Polish context for an explicit new-session fallback when the command has no language signal', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-previous',
      text: 'Zapisz notatkę o spotkaniu.',
      sourceType: 'whatsapp_text',
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'new session' }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(replies.messages[0]?.message).toBe(POLISH_NEW_SESSION_READY_REPLY);
  });

  it('falls back to English for an explicit new-session command without prior context', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-new-session', text: 'new session' }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
    expect(replies.messages[0]?.message).toBe(NEW_SESSION_READY_REPLY);
  });

  it('continues the same session after a completed tool turn', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Saved that note.',
        summary: 'Saved garage code.',
        toolName: 'create_note',
      },
      {
        outcome: 'no_action',
        reply: 'The previous note was about the garage code.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-1', text: 'Create a note: garage code is 7241' }),
      deps(repo, runner, replies)
    );
    const result = await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'What was that about?' }),
      deps(repo, runner, replies)
    );

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(repo.createdSessions).toHaveLength(1);
    expect(repo.sessions[0]).toMatchObject({
      id: 'session-1',
      status: 'waiting_for_user',
    });
    expect(repo.sessions[0]?.activeTool).toBeUndefined();
    expect(runner.calls[1]?.session.id).toBe('session-1');
    expect(runner.calls[1]?.events.map((event) => event.type)).toContain('assistant_message');
  });

  it('resends the previous resource link instead of creating a note for link follow-up complaints', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      lastAssistantMessageAt: '2026-06-24T09:51:00.000Z',
      startReason: 'no_active_session',
      activeTool: 'create_research',
    });
    repo.seedEvent('session-existing', 'tool_call_completed', {
      toolName: 'create_research',
      result: {
        status: 'completed',
        resourceUrl: 'https://intexuraos.cloud/#/research/research-1',
      },
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();
    const resolveRuntimeSettings = runtimeResolverSpy();

    const result = await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'Nie dostałam żadnego linku' }),
      deps(repo, runner, replies, { now: () => NOW }, resolveRuntimeSettings)
    );

    expect(result).toEqual({ sessionId: 'session-existing' });
    expect(runner.calls).toEqual([]);
    expect(resolveRuntimeSettings).not.toHaveBeenCalled();
    expect(repo.createdSessions).toHaveLength(0);
    expect(replies.messages[0]?.message).toContain(
      'https://intexuraos.cloud/#/research/research-1'
    );
    expect(eventPayloads(repo, 'tool_call_completed')).toHaveLength(1);
  });

  it.each([
    {
      text: 'Brak linku',
      result: { htmlLink: 'https://calendar.google.com/event?eid=event-1' },
      expectedUrl: 'https://calendar.google.com/event?eid=event-1',
      sourceUrl: undefined,
    },
    {
      text: 'no link arrived',
      result: { url: 'https://intexuraos.cloud/#/bookmarks/bookmark-1' },
      expectedUrl: 'https://intexuraos.cloud/#/bookmarks/bookmark-1',
      sourceUrl: 'https://storage.example.com/signed/whatsapp/user-1/wamid-image/media.jpg',
    },
    {
      text: 'I did not get the link',
      result: null,
      expectedUrl: null,
      sourceUrl: undefined,
    },
    {
      text: "I didn't get the link",
      result: [],
      expectedUrl: null,
      sourceUrl: undefined,
    },
    {
      text: 'I did not get any link',
      result: { status: 'completed' },
      expectedUrl: null,
      sourceUrl: undefined,
    },
  ])(
    'handles missing-link follow-up variant: $text',
    async ({ text, result, expectedUrl, sourceUrl }) => {
      const repo = new FakeSessionRepository();
      repo.seedSession({
        id: 'session-existing',
        userId: 'user-1',
        channel: 'whatsapp',
        status: 'waiting_for_user',
        startedAt: '2026-06-24T09:50:00.000Z',
        lastUserMessageAt: '2026-06-24T09:50:00.000Z',
        lastAssistantMessageAt: '2026-06-24T09:51:00.000Z',
        startReason: 'no_active_session',
      });
      repo.seedEvent('session-existing', 'tool_call_completed', {
        toolName: 'create_link',
        result,
      });
      const runner = new FakeRunner([]);
      const replies = new FakeReplyPublisher();

      await handleIncomingMessage(
        message({
          messageId: 'wamid-missing-link',
          text,
          ...(sourceUrl === undefined ? {} : { sourceUrl }),
        }),
        deps(repo, runner, replies)
      );

      expect(runner.calls).toEqual([]);
      expect(repo.createdSessions).toHaveLength(0);
      if (expectedUrl === null) {
        expect(replies.messages[0]?.message).toBe(
          text === 'Brak linku'
            ? 'Nie widzę zapisanego linku z poprzedniej akcji. Poproś mnie jeszcze raz wprost, a utworzę zasób od nowa.'
            : 'I do not see a saved link from the previous action. Ask me directly again, and I will create the resource from scratch.'
        );
      } else {
        expect(replies.messages[0]?.message).toBe(
          text === 'Brak linku'
            ? `Link z poprzedniej akcji: ${expectedUrl}`
            : `Link from the previous action: ${expectedUrl}`
        );
      }
    }
  );

  it('skips malformed historical user-message payloads when selecting missing-link reply language', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-malformed',
      text: 123,
      sourceType: 'whatsapp_text',
    });
    repo.seedEvent('session-existing', 'tool_call_completed', {
      toolName: 'create_link',
      result: { url: 'https://intexuraos.cloud/#/bookmarks/bookmark-1' },
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-missing-link', text: 'no link arrived' }),
      deps(repo, runner, replies)
    );

    expect(replies.messages[0]?.message).toBe(
      'Link from the previous action: https://intexuraos.cloud/#/bookmarks/bookmark-1'
    );
  });

  it('expires a stale session and records a diagnostic fallback for completed runner results without a tool name', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-stale',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:00:00.000Z',
      lastUserMessageAt: '2026-06-24T09:00:00.000Z',
      startReason: 'no_active_session',
    });
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Saved it.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'remember the garage code' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions).toMatchObject([
      {
        id: 'session-stale',
        status: 'expired',
        endReason: 'timeout',
      },
      {
        id: 'session-1',
        status: 'waiting_for_user',
      },
    ]);
    expect(repo.sessions[1]?.status).toBe('waiting_for_user');
    expect(repo.sessions[1]?.endReason).toBeUndefined();
    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
    expect(eventTypes(repo)).toEqual([
      'session_closed',
      'session_started',
      'user_message',
      'agent_fallback',
      'clarification_requested',
      'assistant_message',
    ]);
    expect(eventPayloads(repo, 'agent_fallback')[0]).toEqual({
      reason: 'tool_result_mismatch',
      sourceOutcome: 'completed',
    });
    expect(eventPayloads(repo, 'unsupported_request')).toEqual([]);
    expect(replies.messages[0]?.message).toBe('What would you like me to do with this?');
  });

  it('uses prior Polish context when clarifying a malformed completed runner result after a trivial current message', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-previous',
      text: 'Zapisz notatkę o spotkaniu.',
      sourceType: 'whatsapp_text',
    });
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Saved it.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'ok' }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
    expect(eventPayloads(repo, 'agent_fallback')[0]).toEqual({
      reason: 'tool_result_mismatch',
      sourceOutcome: 'completed',
    });
    expect(eventPayloads(repo, 'unsupported_request')).toEqual([]);
    expect(replies.messages[0]?.message).toBe('Co mam z tym zrobić?');
  });

  it('publishes the direct answer instead of generic Polish fallback when runner normalizes a conversation label mistake', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-prior',
      text: 'Jaki jest właściwy następny krok?',
      sourceType: 'whatsapp_text',
    });
    const runner = new FakeRunner([
      {
        outcome: 'no_action',
        reply: 'Właściwy następny krok to utworzyć zadanie programistyczne z opisem problemu.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-answer',
        text: 'Odpowiedz na pytanie z pierwszej wiadomości.',
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'agent_fallback')).toEqual([]);
    expect(eventPayloads(repo, 'clarification_requested')).toEqual([]);
    expect(replies.messages[0]?.message).toBe(
      'Właściwy następny krok to utworzyć zadanie programistyczne z opisem problemu.'
    );
    expect(replies.messages[0]?.message).not.toBe('Co mam z tym zrobić?');
  });

  it('publishes a code-task confirmation instead of generic fallback for a direct code-task request', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_confirmation',
        reply: [
          'Czy utworzyć zadanie programistyczne?',
          '',
          'Polecenie: Investigate direct WhatsApp request fallback.',
          'Tryb: execution',
          'Typ workera: codex-xhigh',
        ].join('\n'),
        toolName: 'create_code_task',
        toolArgs: {
          prompt: 'Investigate direct WhatsApp request fallback.',
          taskMode: 'execution',
          workerType: 'codex-xhigh',
        },
        toolSelection: { turnIndex: 1, ordinal: 1 },
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-code-task',
        text: 'Utwórz code task execution: investigate direct WhatsApp request fallback.',
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'agent_fallback')).toEqual([]);
    expect(eventPayloads(repo, 'clarification_requested')).toEqual([]);
    expect(eventPayloads(repo, 'confirmation_requested')[0]).toMatchObject({
      toolName: 'create_code_task',
      toolArgs: {
        prompt: 'Investigate direct WhatsApp request fallback.',
        taskMode: 'execution',
        workerType: 'codex-xhigh',
      },
      toolSelection: { turnIndex: 1, ordinal: 1 },
    });
    expect(replies.messages[0]?.message).toContain('Czy utworzyć zadanie programistyczne?');
    expect(replies.messages[0]?.message).not.toBe('Co mam z tym zrobić?');
  });

  it('rejects an isolated Matrix tool-selection result on the ordinary handler', async () => {
    const repo = new FakeSessionRepository();
    const replies = new FakeReplyPublisher();
    const runner = new FakeRunner([
      {
        outcome: 'tool_selection_rejected',
        reply: '',
        toolName: 'create_note',
        category: 'behavioral_failure',
        code: 'UNEXPECTED_TOOL_SELECTION',
        toolSelection: { turnIndex: 0, ordinal: 1 },
      },
    ]);

    await expect(
      handleIncomingMessage(message(), deps(repo, runner, replies))
    ).rejects.toThrowError(
      'Matrix corpus tool-selection results require the isolated test handler'
    );
    expect(replies.messages).toEqual([]);
  });

  it('keeps a prompt-preference session clarifiable on an ordinary correction without generic unsupported', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_clarification',
        reply: 'Którą preferencję promptu mam sprawdzić?',
        blockerReason: 'missing_required_details',
        missingFields: ['preference_scope'],
        candidateIntents: ['get_user_preferences'],
        suggestedNextStep: 'Poproś użytkownika o zakres preferencji promptu.',
        clarification: 'Którą preferencję promptu mam sprawdzić?',
      },
      {
        outcome: 'completed',
        reply: 'Jasne, rozumiem.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-prompt-preferences',
        text: 'Czy mamy jakieś preferencje dla promptu agenta?',
      }),
      deps(repo, runner, replies)
    );
    await handleIncomingMessage(
      message({
        messageId: 'wamid-ordinary-correction',
        text: 'Nie o to chodziło, to była zwykła rozmowa bez akcji.',
      }),
      deps(repo, runner, replies)
    );

    expect(runner.calls.map((call) => call.message)).toEqual([
      'Czy mamy jakieś preferencje dla promptu agenta?',
      'Nie o to chodziło, to była zwykła rozmowa bez akcji.',
    ]);
    expect(eventPayloads(repo, 'unsupported_request')).toEqual([]);
    expect(eventPayloads(repo, 'agent_fallback')).toEqual([
      {
        reason: 'tool_result_mismatch',
        sourceOutcome: 'completed',
      },
    ]);
    expect(replies.messages.map((reply) => reply.message)).toEqual([
      'Którą preferencję promptu mam sprawdzić?',
      'Co mam z tym zrobić?',
    ]);
    expect(replies.messages.map((reply) => reply.message)).not.toContain(
      buildUnsupportedCapabilitiesReply('pl')
    );
  });

  it('uses prior text-only event context when malformed fallback skips non-text events', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-non-text',
      text: 42,
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-previous',
      text: 'Zapisz notatkę o spotkaniu.',
    });
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Saved it.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'ok' }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
    expect(eventPayloads(repo, 'agent_fallback')[0]).toEqual({
      reason: 'tool_result_mismatch',
      sourceOutcome: 'completed',
    });
    expect(eventPayloads(repo, 'unsupported_request')).toEqual([]);
    expect(replies.messages[0]?.message).toBe('Co mam z tym zrobić?');
  });
});

function deps(
  sessionRepository: FakeSessionRepository,
  runner: IntexAgentRunner,
  replies: FakeReplyPublisher,
  clock: { now: () => string } = { now: () => NOW },
  resolveRuntimeSettings: Parameters<typeof handleIncomingMessage>[1]['resolveRuntimeSettings'] =
    async () =>
      ok({
        status: 'available',
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        explicitModel: null,
        source: 'default_absent',
        revision: 0,
        timeZone: 'UTC',
      })
): Parameters<typeof handleIncomingMessage>[1] {
  return {
    sessionRepository,
    runner,
    replyPublisher: replies,
    clock,
    resolveRuntimeSettings,
    logger: { warn: () => undefined },
    ids: {
      sessionId: () => `session-${String(sessionRepository.createdSessions.length + 1)}`,
      eventId: () => `event-${String(sessionRepository.events.length + 1)}`,
      confirmationId: () => `confirmation-${String(sessionRepository.events.length + 1)}`,
    },
    sessionTimeoutMs: 30 * 60 * 1000,
  };
}

function runtimeResolverSpy(): ReturnType<typeof vi.fn<
  Parameters<typeof handleIncomingMessage>[1]['resolveRuntimeSettings']
>> {
  return vi.fn(async () =>
    ok({
      status: 'available',
      effectiveModel: IntexAgentModels.DeepSeekV4Flash,
      explicitModel: null,
      source: 'default_absent',
      revision: 0,
      timeZone: 'UTC',
    })
  );
}

function forcedCodeTaskToolClient(args: Record<string, unknown>): ToolCallingClient {
  return {
    async run(params): ReturnType<ToolCallingClient['run']> {
      const tool = params.tools.find((candidate) => candidate.name === 'create_code_task');
      if (tool === undefined) throw new Error('Missing create_code_task tool');
      await tool.run(args);
      return ok({
        content: JSON.stringify({
          outcome: 'completed',
          reply: 'Ready.',
          toolName: 'create_code_task',
        }),
        toolCallsMade: 1,
        iterationCount: 2,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
      } satisfies ToolCallingResult);
    },
  };
}

function forcedCalendarAttendeeUpdateToolClient(): ToolCallingClient {
  return {
    async run(params): ReturnType<ToolCallingClient['run']> {
      const queryTool = params.tools.find(
        (candidate) => candidate.name === 'query_calendar_events'
      );
      const updateTool = params.tools.find(
        (candidate) => candidate.name === 'update_calendar_event'
      );
      if (queryTool === undefined || updateTool === undefined) {
        throw new Error('Missing calendar attendee-update tools');
      }
      await queryTool.run({
        mode: 'list',
        timeMin: '2026-06-25T00:00:00+02:00',
        timeMax: '2026-06-26T00:00:00+02:00',
        query: 'Bagrowa',
      });
      await updateTool.run({
        eventId: 'event-bagrowa',
        eventSummary: 'Bagrowa',
        attendeesToAdd: ['patryk@example.com'],
      });
      return ok({
        content: JSON.stringify({
          outcome: 'completed',
          reply: 'Ready.',
          toolName: 'update_calendar_event',
        }),
        toolCallsMade: 2,
        iterationCount: 3,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
      } satisfies ToolCallingResult);
    },
  };
}

function codeTaskCapturingExecutor(
  createCodeTaskCalls: Record<string, unknown>[]
): IntexAgentToolExecutor {
  const unsupported = async (): Promise<string> => JSON.stringify({ status: 'completed' });
  return {
    createNote: unsupported,
    createCalendarEvent: unsupported,
    updateCalendarEvent: unsupported,
    queryCalendarEvents: unsupported,
    createResearch: unsupported,
    createLink: unsupported,
    async createCodeTask(args): Promise<string> {
      createCodeTaskCalls.push({ ...args });
      return JSON.stringify({ status: 'completed', id: 'task-1' });
    },
    saveExternal: unsupported,
    getUserPreferences: unsupported,
    addUserPreference: unsupported,
    updateUserPreference: unsupported,
    deleteUserPreference: unsupported,
  };
}

function calendarUpdateCapturingExecutor(
  updateCalendarCalls: Record<string, unknown>[]
): IntexAgentToolExecutor {
  const unsupported = async (): Promise<string> => JSON.stringify({ status: 'completed' });
  return {
    createNote: unsupported,
    createCalendarEvent: unsupported,
    async updateCalendarEvent(args): Promise<string> {
      updateCalendarCalls.push(structuredClone({ ...args }));
      return JSON.stringify({
        status: 'completed',
        eventId: args.eventId,
        summary: args.eventSummary,
        attendeesAdded: args.attendeesToAdd,
      });
    },
    async queryCalendarEvents(): Promise<string> {
      return JSON.stringify({
        status: 'completed',
        mode: 'list',
        count: 1,
        truncated: false,
        events: [
          {
            id: 'event-bagrowa',
            etag: '"event-bagrowa-v1"',
            summary: 'Bagrowa',
            calendarId: 'primary',
            start: { dateTime: '2026-06-25T18:00:00+02:00' },
            end: { dateTime: '2026-06-25T20:30:00+02:00' },
          },
        ],
      });
    },
    createResearch: unsupported,
    createLink: unsupported,
    createCodeTask: unsupported,
    saveExternal: unsupported,
    getUserPreferences: unsupported,
    addUserPreference: unsupported,
    updateUserPreference: unsupported,
    deleteUserPreference: unsupported,
  };
}

class SequenceClock {
  private index = 0;

  constructor(private readonly values: string[]) {}

  now(): string {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error('No fake clock value configured');
    }
    this.index += 1;
    return value;
  }
}

function eventTypes(repo: FakeSessionRepository): IntexAgentSessionEventType[] {
  return repo.events.map((event) => event.type);
}

function eventPayloads(
  repo: FakeSessionRepository,
  type: IntexAgentSessionEventType
): Record<string, unknown>[] {
  return repo.events.filter((event) => event.type === type).map((event) => event.payload);
}

function calendarUpdateOperation(eventId: string): {
  toolName: 'update_calendar_event';
  toolArgs: Record<string, unknown>;
} {
  return {
    toolName: 'update_calendar_event',
    toolArgs: {
      eventId,
      eventSummary: `Event ${eventId}`,
      calendarId: 'primary',
      expectedEtag: `"${eventId}-v1"`,
      eventStart: { date: '2026-08-13' },
      eventEnd: { date: '2026-08-14' },
      changes: { summary: `Updated ${eventId}` },
    },
  };
}

function seedPendingConfirmation(
  repo: FakeSessionRepository,
  pending: {
    confirmationId: string;
    toolName: IntexAgentToolName;
    toolArgs: Record<string, unknown>;
    operations?: readonly {
      toolName: IntexAgentToolName;
      toolArgs: Record<string, unknown>;
    }[];
  }
): void {
  repo.seedSession({
    id: 'session-existing',
    userId: 'user-1',
    channel: 'whatsapp',
    status: 'waiting_for_user',
    startedAt: '2026-06-24T09:50:00.000Z',
    lastUserMessageAt: '2026-06-24T09:50:00.000Z',
    lastAssistantMessageAt: '2026-06-24T09:51:00.000Z',
    startReason: 'no_active_session',
    activeTool: pending.toolName,
  });
  repo.seedEvent('session-existing', 'confirmation_requested', {
    confirmationId: pending.confirmationId,
    toolName: pending.toolName,
    toolArgs: pending.toolArgs,
    message: 'Czy wykonać tę akcję?',
    sourceMessageId: 'wamid-original',
    ...(pending.operations !== undefined ? { operations: pending.operations } : {}),
  });
}

class FakeSessionRepository implements SessionRepository {
  readonly sessions: IntexAgentSession[] = [];
  readonly events: IntexAgentSessionEvent[] = [];
  readonly createdSessions: IntexAgentSession[] = [];

  seedSession(session: IntexAgentSession): void {
    this.sessions.push(session);
  }

  seedEvent(sessionId: string, type: IntexAgentSessionEventType, payload: Record<string, unknown>): void {
    this.events.push({
      id: `seed-${String(this.events.length + 1)}`,
      sessionId,
      userId: 'user-1',
      type,
      payload,
      createdAt: NOW,
    });
  }

  listSessions(userId: string): Promise<IntexAgentSession[]> {
    return Promise.resolve(this.sessions.filter((session) => session.userId === userId));
  }

  getSession(sessionId: string, userId: string): Promise<IntexAgentSession | null> {
    return Promise.resolve(
      this.sessions.find((session) => session.id === sessionId && session.userId === userId) ?? null
    );
  }

  listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]> {
    return Promise.resolve(
      this.events.filter((event) => event.sessionId === sessionId && event.userId === userId)
    );
  }

  findOpenSession(userId: string): Promise<IntexAgentSession | null> {
    return Promise.resolve(
      this.sessions.find(
        (session) =>
          session.userId === userId &&
          ['active', 'waiting_for_user', 'executing_tool'].includes(session.status)
      ) ?? null
    );
  }

  findContinuableSession(userId: string): Promise<IntexAgentSession | null> {
    return this.findOpenSession(userId);
  }

  createSession(draft: SessionRepositorySessionDraft): Promise<IntexAgentSession> {
    const session: IntexAgentSession = { ...draft };
    this.sessions.push(session);
    this.createdSessions.push(session);
    return Promise.resolve(session);
  }

  updateSession(sessionId: string, update: SessionRepositorySessionUpdate): Promise<IntexAgentSession> {
    const index = this.sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) {
      throw new Error(`Missing session ${sessionId}`);
    }
    const updated: IntexAgentSession = { ...this.sessions[index], ...update } as IntexAgentSession;
    if (update.activeTool === null) {
      delete updated.activeTool;
    }
    this.sessions[index] = updated;
    return Promise.resolve(updated);
  }

  appendEvent(event: IntexAgentSessionEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class FakeRunner implements IntexAgentRunner {
  readonly calls: {
    session: IntexAgentSession;
    events: IntexAgentSessionEvent[];
    message: string;
    replyContext?: IntexIncomingMessage['replyContext'];
    sourceType?: string;
    sourceUrl?: string;
    currentDateTime: string;
  }[] = [];
  readonly executeConfirmedCalls: Parameters<IntexAgentRunner['executeConfirmed']>[0][] = [];

  constructor(
    private readonly results: IntexAgentRunnerResult[],
    private readonly confirmedResults: IntexAgentRunnerResult[] = []
  ) {}

  executeConfirmed(input: Parameters<IntexAgentRunner['executeConfirmed']>[0]): Promise<IntexAgentRunnerResult> {
    this.executeConfirmedCalls.push(input);
    const next = this.confirmedResults.shift();
    if (next === undefined) {
      throw new Error('No fake confirmed runner result configured');
    }
    return Promise.resolve(next);
  }

  run(input: {
    session: IntexAgentSession;
    events: IntexAgentSessionEvent[];
    message: string;
    replyContext?: IntexIncomingMessage['replyContext'];
    sourceType?: string;
    sourceUrl?: string;
    currentDateTime: string;
  }): Promise<IntexAgentRunnerResult> {
    this.calls.push(input);
    const next = this.results.shift();
    if (next === undefined) {
      throw new Error('No fake runner result configured');
    }
    return Promise.resolve(next);
  }
}

class FakeReplyPublisher implements WhatsAppReplyPublisher {
  readonly messages: {
    userId: string;
    message: string;
    replyToMessageId: string;
    correlationId: string;
    ctaUrl?: {
      displayText: string;
      url: string;
    };
    buttons?: Parameters<WhatsAppReplyPublisher['publishReply']>[0]['buttons'];
  }[] = [];

  publishReply(input: {
    userId: string;
    message: string;
    replyToMessageId: string;
    correlationId: string;
    ctaUrl?: {
      displayText: string;
      url: string;
    };
    buttons?: Parameters<WhatsAppReplyPublisher['publishReply']>[0]['buttons'];
  }): Promise<void> {
    this.messages.push(input);
    return Promise.resolve();
  }
}
