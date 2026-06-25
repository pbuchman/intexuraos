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
    const client = new ToolExecutingFakeToolCallingClient({
      toolName: 'create_note',
      args: { content: 'The door code is 1234.', title: 'Door code' },
    }, [
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
    expect(INTEX_AGENT_SYSTEM_PROMPT.version).toBe('3.0.0');
    expect(client.calls[0]?.systemPrompt).toContain('You are Intex in WhatsApp Assistant conversations.');
    expect(client.calls[0]?.systemPrompt).not.toContain('You are IntexuraOS');
    expect(client.calls[0]?.systemPrompt).toContain('Code tasks default to planning mode');
    expect(client.calls[0]?.systemPrompt).toContain('execution');
    expect(client.calls[0]?.systemPrompt).toContain('Return no_action');
    expect(client.calls[0]?.systemPrompt).toContain('Do not use create_research to inspect personal IntexuraOS data');
    expect(client.calls[0]?.systemPrompt).toContain('what is in my calendar');
    expect(client.calls[0]?.systemPrompt).toContain('If the request is not one of the supported jobs, do not call a tool');
    expect(client.calls[0]?.systemPrompt).not.toMatch(/approval|command classification|action queue|voice/i);
    expect(client.calls[0]?.messages).toEqual([
      { role: 'user', content: 'create event tomorrow' },
      { role: 'assistant', content: 'What time?' },
      { role: 'user', content: 'remember the door code' },
    ]);
    expect(client.calls[0]?.tools.map((tool) => tool.name)).toEqual(['create_note']);
    expect(client.calls[0]?.toolChoice).toBe('auto');
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
          reply:
            'I do not support that yet. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'buy a ticket' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply:
        'I do not support that yet. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
    });
  });

  it('normalizes no-action responses for greetings without closing the session', async () => {
    const client = new FakeToolCallingClient([]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'Cześć! Co u Ciebie?' })
    ).resolves.toEqual({
      outcome: 'no_action',
      reply: 'Cześć! U mnie wszystko w porządku. W czym mogę pomóc?',
    });
    expect(client.calls).toEqual([]);
  });

  it('does not expose tools for informational questions that lack explicit creation intent', async () => {
    const client = new FakeToolCallingClient([
      ok(
        toolResult({
          outcome: 'no_action',
          reply: 'HTTP requests include a method, URL, headers, and optional body.',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({
        session: session(),
        events: [],
        message: 'A jak wygląda taki schemat request o HTTP, który wykonujesz?',
      })
    ).resolves.toEqual({
      outcome: 'no_action',
      reply: 'HTTP requests include a method, URL, headers, and optional body.',
    });
    expect(client.calls[0]?.tools).toEqual([]);
    expect(client.calls[0]?.toolChoice).toBe('auto');
  });

  it('blocks read-only calendar questions instead of creating research', async () => {
    const client = new FakeToolCallingClient([]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({
        session: session(),
        events: [],
        message: 'Chciałbym zobaczyć, jakie mam wydarzenia w kalendarzu na jutro',
      })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply:
        'Nie mogę jeszcze przeglądać Twojego kalendarza ani sprawdzać zaplanowanych wydarzeń. Mogę utworzyć nowe wydarzenie, jeśli poprosisz o to wprost.',
    });
    expect(client.calls).toEqual([]);
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
      reply:
        'I could not safely understand that request. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
    });
  });

  it('ignores malformed historical events when building the transcript', async () => {
    const client = new ToolExecutingFakeToolCallingClient({
      toolName: 'create_note',
      args: { content: 'Parking spot is B12.' },
    }, [
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'Done.',
          summary: 'Saved note',
          toolName: 'create_note',
        })
      ),
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
      toolName: 'create_note',
    });
    expect(client.calls[0]?.messages).toEqual([
      { role: 'user', content: 'remember the parking spot' },
    ]);
  });

  it('includes assistant messages and completed tool summaries in continuity history', async () => {
    const client = new ToolExecutingFakeToolCallingClient({
      toolName: 'create_note',
      args: { content: 'Office pin is 2468.' },
    }, [
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'Saved.',
          toolName: 'create_note',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({
        session: session(),
        message: 'remember the office pin',
        events: [
          event('assistant_message', { text: 'Saved the previous item.' }),
          event('tool_call_completed', {
            toolName: 'create_research',
            result: { resourceUrl: 'https://intexuraos.cloud/#/research/research-1' },
          }),
          event('tool_call_completed', { toolName: 'create_note' }),
          event('assistant_message', { text: false }),
          event('tool_call_completed', { toolName: false, result: {} }),
          event('unsupported_request', { message: 'Unsupported.' }),
        ],
      })
    ).resolves.toEqual({
      outcome: 'completed',
      reply: 'Saved.',
      toolName: 'create_note',
    });
    expect(client.calls[0]?.messages).toEqual([
      { role: 'assistant', content: 'Saved the previous item.' },
      {
        role: 'assistant',
        content:
          'Tool create_research completed: {"resourceUrl":"https://intexuraos.cloud/#/research/research-1"}',
      },
      { role: 'assistant', content: 'Tool create_note completed: {}' },
      { role: 'user', content: 'remember the office pin' },
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
      reply:
        'I could not safely understand that request. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
    });
  });

  it('returns unsupported when the model omits required response fields', async () => {
    const client = new FakeToolCallingClient([ok(toolResult({ outcome: 'completed' }))]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'remember this' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply:
        'I could not safely understand that request. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
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
      reply:
        'I could not safely understand that request. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
    });
  });

  it.each(['create_research', 'create_link', 'create_code_task'] as const)(
    'keeps supported completed tool names: %s',
    async (toolName) => {
      const client = new ToolExecutingFakeToolCallingClient({
        toolName,
        args: toolArgsFor(toolName),
      }, [
        ok(
          toolResult({
            outcome: 'completed',
            reply: 'Done.',
            summary: 'Handled request.',
            toolName,
          })
        ),
      ]);
      const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

      await expect(
        runner.run({ session: session(), events: [], message: explicitMessageFor(toolName) })
      ).resolves.toEqual({
        outcome: 'completed',
        reply: 'Done.',
        summary: 'Handled request.',
        toolName,
      });
    }
  );

  it('uses the executed tool result and deterministic link reply when the final model JSON omits toolName', async () => {
    const client = new ToolExecutingFakeToolCallingClient({
      toolName: 'create_research',
      args: {
        title: 'Calendar events tomorrow',
        prompt: 'Prepare a research draft about tomorrow calendar events.',
      },
    }, [
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'Created a research draft without the link.',
          summary: 'Calendar events tomorrow',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({
      client,
      toolExecutor: fakeToolExecutor({
        createResearch: async () =>
          JSON.stringify({
            status: 'completed',
            message: 'Research created',
            resourceUrl: 'https://intexuraos.cloud/#/research/research-1',
          }),
      }),
    });

    await expect(
      runner.run({
        session: session(),
        events: [],
        message: 'Create research draft: calendar events tomorrow',
      })
    ).resolves.toEqual({
      outcome: 'completed',
      reply:
        'Utworzyłem szkic researchu: https://intexuraos.cloud/#/research/research-1',
      summary: 'Calendar events tomorrow',
      toolName: 'create_research',
      toolResult: {
        status: 'completed',
        message: 'Research created',
        resourceUrl: 'https://intexuraos.cloud/#/research/research-1',
      },
    });
  });

  it.each([
    {
      toolName: 'create_code_task' as const,
      message: 'Create code task to investigate webhook retries',
      args: { prompt: 'Investigate webhook retries.' },
      executorOverride: {
        createCodeTask: async (): Promise<string> =>
          JSON.stringify({
            status: 'completed',
            resourceUrl: 'https://intexuraos.cloud/#/code-tasks/task-1',
          }),
      },
      expectedReply:
        'Utworzyłem zadanie programistyczne: https://intexuraos.cloud/#/code-tasks/task-1',
    },
    {
      toolName: 'create_calendar_event' as const,
      message: 'Add calendar event for dentist tomorrow 9-10',
      args: {
        summary: 'Dentist',
        start: '2026-06-25T09:00:00+02:00',
        end: '2026-06-25T10:00:00+02:00',
      },
      executorOverride: {
        createCalendarEvent: async (): Promise<string> =>
          JSON.stringify({
            status: 'completed',
            htmlLink: 'https://calendar.google.com/event?eid=event-1',
          }),
      },
      expectedReply:
        'Utworzyłem wydarzenie w kalendarzu: https://calendar.google.com/event?eid=event-1',
    },
    {
      toolName: 'create_link' as const,
      message: 'Save link https://example.com/post',
      args: { url: 'https://example.com/post', title: 'Example' },
      executorOverride: {
        createLink: async (): Promise<string> =>
          JSON.stringify({
            status: 'completed',
            url: 'https://intexuraos.cloud/#/bookmarks/bookmark-1',
          }),
      },
      expectedReply: 'Zapisałem link: https://intexuraos.cloud/#/bookmarks/bookmark-1',
    },
    {
      toolName: 'create_note' as const,
      message: 'Create a note: office printer pin is 1357',
      args: { content: 'Office printer pin is 1357.' },
      executorOverride: {
        createNote: async (): Promise<string> =>
          JSON.stringify({
            status: 'completed',
            resourceUrl: '',
            message: 'Zapisałem notatkę.',
          }),
      },
      expectedReply: 'Zapisałem notatkę.',
    },
    {
      toolName: 'create_note' as const,
      message: 'Create a note: office room is London',
      args: { content: 'Office room is London.' },
      executorOverride: {
        createNote: async (): Promise<string> =>
          JSON.stringify({
            status: 'completed',
            resourceUrl: 'https://intexuraos.cloud/#/notes/note-1',
          }),
      },
      expectedReply:
        'The model reply should not be the source of truth. https://intexuraos.cloud/#/notes/note-1',
    },
    {
      toolName: 'create_note' as const,
      message: 'Create a note: laptop locker is 4',
      args: { content: 'Laptop locker is 4.' },
      executorOverride: {
        createNote: async (): Promise<string> =>
          JSON.stringify({
            status: 'completed',
          }),
      },
      expectedReply: 'The model reply should not be the source of truth.',
    },
  ])('builds deterministic confirmations from %s tool results', async (testCase) => {
    const client = new ToolExecutingFakeToolCallingClient({
      toolName: testCase.toolName,
      args: testCase.args,
    }, [
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'The model reply should not be the source of truth.',
          toolName: testCase.toolName,
        })
      ),
    ]);
    const runner = createIntexAgentRunner({
      client,
      toolExecutor: fakeToolExecutor(testCase.executorOverride),
    });

    const result = await runner.run({
      session: session(),
      events: [],
      message: testCase.message,
    });

    expect(result).toMatchObject({
      outcome: 'completed',
      reply: testCase.expectedReply,
      toolName: testCase.toolName,
    });
  });

  it('rejects completed responses when no tool actually ran and no supported toolName is present', async () => {
    const client = new FakeToolCallingClient([
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'Done.',
          summary: 'Handled request.',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'Create a note: remember this' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply:
        'I could not safely understand that request. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
    });
  });

  it('rejects completed responses when the model claims a supported toolName but no tool ran', async () => {
    const client = new FakeToolCallingClient([
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'Done.',
          summary: 'Handled request.',
          toolName: 'create_note',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'remember this' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply:
        'I could not safely understand that request. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
    });
  });

  it('rejects completed responses when multiple tools ran in one turn', async () => {
    const client = new FakeToolCallingClient([]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({
        session: session(),
        events: [],
        message: 'Create a note: visit Lisbon and save link https://example.com',
      })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply:
        'I could not safely understand that request. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
    });
    expect(client.calls).toEqual([]);
  });

  it('rejects unsupported completed tool names from normalized responses', async () => {
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
      outcome: 'unsupported',
      reply:
        'I could not safely understand that request. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
    });
  });

  it('returns unsupported when the tool-calling client fails', async () => {
    const client = new FakeToolCallingClient([err({ code: 'API_ERROR', message: 'provider failed' })]);
    const runner = createIntexAgentRunner({ client, toolExecutor: fakeToolExecutor() });

    await expect(
      runner.run({ session: session(), events: [], message: 'remember this' })
    ).resolves.toEqual({
      outcome: 'unsupported',
      reply:
        'I could not complete that request right now. I can create notes, calendar events, research drafts, bookmarks, and code tasks.',
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

function fakeToolExecutor(overrides: Partial<IntexAgentToolExecutor> = {}): IntexAgentToolExecutor {
  return {
    createNote: async () => 'note-1',
    createCalendarEvent: async () => 'event-1',
    createResearch: async () => 'research-1',
    createLink: async () => 'bookmark-1',
    createCodeTask: async () => 'code-task-1',
    ...overrides,
  };
}

function toolArgsFor(toolName: 'create_research' | 'create_link' | 'create_code_task'): Record<string, unknown> {
  if (toolName === 'create_research') {
    return { title: 'Research topic', prompt: 'Research this topic.' };
  }
  if (toolName === 'create_link') {
    return { url: 'https://example.com', title: 'Example' };
  }
  return { prompt: 'Investigate this code issue.' };
}

function explicitMessageFor(toolName: 'create_research' | 'create_link' | 'create_code_task'): string {
  if (toolName === 'create_research') {
    return 'Create research draft about this topic.';
  }
  if (toolName === 'create_link') {
    return 'Save link https://example.com/post';
  }
  return 'Create code task to investigate this issue.';
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

class ToolExecutingFakeToolCallingClient extends FakeToolCallingClient {
  constructor(
    private readonly toolCalls: { toolName: string; args: Record<string, unknown> } | { toolName: string; args: Record<string, unknown> }[],
    results: Result<ToolCallingResult, LLMError>[]
  ) {
    super(results);
  }

  override async run(
    params: Parameters<ToolCallingClient['run']>[0]
  ): Promise<Result<ToolCallingResult, LLMError>> {
    const toolCalls = Array.isArray(this.toolCalls) ? this.toolCalls : [this.toolCalls];
    for (const toolCall of toolCalls) {
      const tool = params.tools.find((candidate) => candidate.name === toolCall.toolName);
      if (tool === undefined) {
        throw new Error(`Missing fake tool ${toolCall.toolName}`);
      }
      await tool.run(toolCall.args);
    }
    return await super.run(params);
  }
}
