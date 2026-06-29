import { describe, expect, it } from 'vitest';
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
import {
  handleIncomingMessage,
  type IntexAgentRunner,
  type IntexAgentRunnerResult,
  type WhatsAppReplyPublisher,
} from '../../domain/messages/handleIncomingMessage.js';

const NOW = '2026-06-24T10:00:00.000Z';
const UNSUPPORTED_CAPABILITIES_REPLY = [
  'I could not safely handle that request. I can help with:',
  '- summarize and reason over the current session',
  '- create notes',
  '- create and look up calendar events',
  '- create research drafts',
  '- save bookmarks',
  '- create code tasks for planning or execution',
  '- manage INTEX Agent prompt preferences',
].join('\n');
const NEW_SESSION_READY_REPLY = [
  'What would you like me to help with? I can help with:',
  '- summarize and reason over the current session',
  '- create notes',
  '- create and look up calendar events',
  '- create research drafts',
  '- save bookmarks',
  '- create code tasks for planning or execution',
  '- manage INTEX Agent prompt preferences',
].join('\n');
const POLISH_UNSUPPORTED_CAPABILITIES_REPLY = [
  'Nie mogłem bezpiecznie obsłużyć tej prośby. Mogę pomóc z:',
  '- podsumowywaniem i analizowaniem bieżącej sesji',
  '- tworzeniem notatek',
  '- tworzeniem i sprawdzaniem wydarzeń w kalendarzu',
  '- tworzeniem szkiców researchu',
  '- zapisywaniem bookmarków',
  '- tworzeniem zadań programistycznych do planowania lub wykonania',
  '- zarządzaniem preferencjami promptu agenta INTEX',
].join('\n');
const POLISH_NEW_SESSION_READY_REPLY = [
  'W czym mogę pomóc? Mogę pomóc z:',
  '- podsumowywaniem i analizowaniem bieżącej sesji',
  '- tworzeniem notatek',
  '- tworzeniem i sprawdzaniem wydarzeń w kalendarzu',
  '- tworzeniem szkiców researchu',
  '- zapisywaniem bookmarków',
  '- tworzeniem zadań programistycznych do planowania lub wykonania',
  '- zarządzaniem preferencjami promptu agenta INTEX',
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
      deps(repo, runner, replies)
    );

    expect(result).toEqual({ sessionId: 'session-existing' });
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
    });
    expect(replies.messages[0]?.message).toBe(
      'Nie udało się wykonać tej akcji: downstream denied it. Spróbuj ponownie później.'
    );
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
      deps(repo, runner, replies)
    );

    expect(runner.calls).toEqual([]);
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
      deps(repo, runner, replies)
    );

    expect(result).toEqual({ sessionId: 'wamid-button-without-session' });
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

  it('treats plain text tak as a new message instead of executing a pending confirmation', async () => {
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
      message({ messageId: 'wamid-text-tak', text: 'tak', sourceType: 'whatsapp_text' }),
      deps(repo, runner, replies)
    );

    expect(runner.calls).toHaveLength(1);
    expect(runner.executeConfirmedCalls).toEqual([]);
    expect(eventPayloads(repo, 'confirmation_resolved')[0]).toEqual({
      confirmationId: 'confirm-1',
      resolution: 'superseded',
    });
    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([]);
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
  });

  it('creates a calendar event in one message when the request has complete date and time details', async () => {
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
    expect(repo.sessions[0]?.activeTool).toBe('create_calendar_event');
    expect(repo.sessions[0]?.summary).toBeUndefined();
    expect(eventPayloads(repo, 'tool_call_completed')[0]).toMatchObject({
      toolName: 'create_calendar_event',
    });
    expect(replies.messages[0]?.message).toBe('Created the calendar event.');
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
    expect(replies.messages[0]?.message).toBe('Which day should I schedule it for?');
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
    expect(replies.messages).toEqual([
      {
        userId: 'user-1',
        message: 'Scheduled it for tomorrow.',
        replyToMessageId: 'wamid-2',
        correlationId: 'session-existing',
      },
    ]);
  });

  it('replies unsupported and keeps the session available for follow-up context', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'unsupported',
        reply: 'I do not support that yet. I can create notes and calendar events.',
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
      'unsupported_request',
      'assistant_message',
    ]);
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

    const result = await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'new session' }),
      deps(repo, runner, replies)
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
      activeTool: 'create_note',
    });
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

    const result = await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'Nie dostałam żadnego linku' }),
      deps(repo, runner, replies)
    );

    expect(result).toEqual({ sessionId: 'session-existing' });
    expect(runner.calls).toEqual([]);
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

  it('expires a stale session and rejects completed runner results without a tool name', async () => {
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
    expect(replies.messages[0]?.message).toBe(UNSUPPORTED_CAPABILITIES_REPLY);
  });

  it('uses prior Polish context when rejecting a malformed completed runner result after a trivial current message', async () => {
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
    expect(replies.messages[0]?.message).toBe(POLISH_UNSUPPORTED_CAPABILITIES_REPLY);
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
    expect(replies.messages[0]?.message).toBe(POLISH_UNSUPPORTED_CAPABILITIES_REPLY);
  });
});

function deps(
  sessionRepository: FakeSessionRepository,
  runner: FakeRunner,
  replies: FakeReplyPublisher,
  clock: { now: () => string } = { now: () => NOW }
): Parameters<typeof handleIncomingMessage>[1] {
  return {
    sessionRepository,
    runner,
    replyPublisher: replies,
    clock,
    ids: {
      sessionId: () => `session-${String(sessionRepository.createdSessions.length + 1)}`,
      eventId: () => `event-${String(sessionRepository.events.length + 1)}`,
      confirmationId: () => `confirmation-${String(sessionRepository.events.length + 1)}`,
    },
    sessionTimeoutMs: 30 * 60 * 1000,
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

function seedPendingConfirmation(
  repo: FakeSessionRepository,
  pending: {
    confirmationId: string;
    toolName: IntexAgentToolName;
    toolArgs: Record<string, unknown>;
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
  readonly executeConfirmedCalls: {
    session: IntexAgentSession;
    toolName: IntexAgentToolName;
    toolArgs: Record<string, unknown>;
    currentDateTime: string;
    messageId?: string;
  }[] = [];

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
