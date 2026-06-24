import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  LLMError,
  ToolCallingClient,
  ToolCallingResult,
} from '@intexuraos/llm-contract';
import { describe, expect, it } from 'vitest';
import type { IntexAgentToolExecutor } from '../../domain/agent/toolDefinitions.js';
import { createIntexAgentRunner } from '../../domain/agent/intexAgentRunner.js';
import { INTEX_AGENT_SYSTEM_PROMPT } from '../../domain/agent/systemPrompt.js';
import type { IntexAgentSession, IntexAgentSessionEvent } from '../../domain/sessions/types.js';

describe('createIntexAgentRunner', () => {
  it('uses the versioned prompt, transcript messages, and supported tools', async () => {
    const client = new FakeToolCallingClient([
      ok(toolResult({ outcome: 'completed', reply: 'Saved.', toolName: 'create_note' })),
    ]);

    const runner = createIntexAgentRunner({
      client,
      toolExecutor: fakeToolExecutor(),
    });

    const result = await runner.run({
      session: session(),
      message: 'remember the door code',
      events: [
        event('user_message', { text: 'create event tomorrow' }),
        event('clarification_requested', { message: 'What time?' }),
        event('assistant_message', { text: 'What time?' }),
      ],
    });

    expect(result).toEqual({
      outcome: 'completed',
      reply: 'Saved.',
      toolName: 'create_note',
    });
    expect(client.calls[0]?.systemPrompt).toBe(INTEX_AGENT_SYSTEM_PROMPT.text);
    expect(INTEX_AGENT_SYSTEM_PROMPT.version).toBe('0.1.0');
    expect(client.calls[0]?.messages).toEqual([
      { role: 'user', content: 'create event tomorrow' },
      { role: 'assistant', content: 'What time?' },
      { role: 'user', content: 'remember the door code' },
    ]);
    expect(client.calls[0]?.tools.map((tool) => tool.name)).toEqual([
      'create_note',
      'create_calendar_event',
    ]);
    expect(client.calls[0]?.promptType).toBe('intex-agent-whatsapp-session');
  });

  it('normalizes clarification responses', async () => {
    const client = new FakeToolCallingClient([
      ok(toolResult({ outcome: 'needs_clarification', reply: 'Which day?' })),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'create dentist appointment' })
    ).resolves.toEqual({ outcome: 'needs_clarification', reply: 'Which day?' });
  });

  it('normalizes unsupported responses', async () => {
    const client = new FakeToolCallingClient([
      ok(
        toolResult({
          outcome: 'unsupported',
          reply: 'I do not support that yet. I can create notes and calendar events.',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'buy a ticket' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply: 'I do not support that yet. I can create notes and calendar events.',
    });
  });

  it('returns unsupported when the model result is malformed instead of executing a hidden action', async () => {
    const client = new FakeToolCallingClient([
      ok({
        content: 'plain text',
        toolCallsMade: 0,
        iterationCount: 1,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
      }),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'something weird' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply: 'I could not safely understand that request. I can create notes and calendar events.',
    });
  });

  it('ignores malformed historical events when building the transcript', async () => {
    const client = new FakeToolCallingClient([
      ok(toolResult({ outcome: 'completed', reply: 'Done.', summary: 'Saved note' })),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({
        session: session(),
        message: 'remember the parking spot',
        events: [
          event('user_message', { text: 42 }),
          event('clarification_requested', { message: false }),
        ],
      })
    ).resolves.toEqual({
      outcome: 'completed',
      reply: 'Done.',
      summary: 'Saved note',
    });
    expect(client.calls[0]?.messages).toEqual([
      { role: 'user', content: 'remember the parking spot' },
    ]);
  });

  it('returns unsupported when the model returns a non-object JSON value', async () => {
    const client = new FakeToolCallingClient([
      ok({
        content: '[]',
        toolCallsMade: 0,
        iterationCount: 1,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
      }),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'something weird' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply: 'I could not safely understand that request. I can create notes and calendar events.',
    });
  });

  it('returns unsupported when the model omits required response fields', async () => {
    const client = new FakeToolCallingClient([ok(toolResult({ outcome: 'completed' }))]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'remember this' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply: 'I could not safely understand that request. I can create notes and calendar events.',
    });
  });

  it('returns unsupported when the model uses an unknown outcome', async () => {
    const client = new FakeToolCallingClient([
      ok(toolResult({ outcome: 'delegated', reply: 'Working on it.' })),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'do something else' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply: 'I could not safely understand that request. I can create notes and calendar events.',
    });
  });

  it('drops unsupported completed tool names from normalized responses', async () => {
    const client = new FakeToolCallingClient([
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'Done.',
          summary: 'Handled request.',
          toolName: 'send_email',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'remember this' })
    ).resolves.toEqual({
      outcome: 'completed',
      reply: 'Done.',
      summary: 'Handled request.',
    });
  });

  it('returns unsupported when the tool-calling client fails', async () => {
    const client = new FakeToolCallingClient([err({ code: 'API_ERROR', message: 'provider failed' })]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'remember this' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply: 'I could not complete that request right now. I can create notes and calendar events.',
    });
  });
});

function toolResult(content: Record<string, unknown>): ToolCallingResult {
  return {
    content: JSON.stringify(content),
    toolCallsMade: 1,
    iterationCount: 2,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
  };
}

function session(): IntexAgentSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    channel: 'whatsapp',
    status: 'active',
    startedAt: '2026-06-24T10:00:00.000Z',
    lastUserMessageAt: '2026-06-24T10:00:00.000Z',
    startReason: 'no_active_session',
  };
}

function event(type: IntexAgentSessionEvent['type'], payload: Record<string, unknown>): IntexAgentSessionEvent {
  return {
    id: `event-${type}`,
    sessionId: 'session-1',
    userId: 'user-1',
    type,
    payload,
    createdAt: '2026-06-24T10:00:00.000Z',
  };
}

function fakeToolExecutor(): IntexAgentToolExecutor {
  return {
    createNote: async () => 'note-1',
    createCalendarEvent: async () => 'event-1',
  };
}

class FakeToolCallingClient implements ToolCallingClient {
  readonly calls: Parameters<ToolCallingClient['run']>[0][] = [];

  constructor(private readonly results: Result<ToolCallingResult, LLMError>[]) {}

  run(params: Parameters<ToolCallingClient['run']>[0]): Promise<Result<ToolCallingResult, LLMError>> {
    this.calls.push(params);
    const next = this.results.shift();
    if (next === undefined) {
      throw new Error('No fake tool result configured');
    }
    return Promise.resolve(next);
  }
}
