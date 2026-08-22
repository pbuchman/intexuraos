import { err, ok } from '@intexuraos/common-core';
import type { LlmChatMessage } from '@intexuraos/llm-contract';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { buildWhatsAppConversationAssistantMessages } from '@intexuraos/llm-prompts';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationAssistantLlmClientFactory } from '../../domain/conversation-assistant/ports.js';
import type { ConversationAssistantTurnRequestPromptSnapshot } from '../../domain/conversation-assistant/turnRequestPorts.js';
import {
  CONVERSATION_ASSISTANT_TURN_RUNNER_HARD_PROMPT_TOKEN_LIMIT,
  createConversationAssistantTurnRunner,
  estimateConversationAssistantTurnPromptTokens,
} from '../../infra/llm/conversationAssistantTurnRunner.js';

const USAGE = { inputTokens: 120, outputTokens: 9, totalTokens: 129, costUsd: 0.003 };

function snapshot(
  overrides: Partial<ConversationAssistantTurnRequestPromptSnapshot> = {}
): ConversationAssistantTurnRequestPromptSnapshot {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    model: 'or:google/gemini-3.5-flash',
    transcriptText: '  [2026-07-14] Them: byte-stable\r\n\u0000evidence  ',
    chatDisplayName: 'A conversation',
    range: { from: '2026-07-14T00:00:00.000Z', to: '2026-07-18T00:00:00.000Z' },
    effectiveRange: {
      from: '2026-07-14T08:00:00.000Z',
      to: '2026-07-17T18:00:00.000Z',
    },
    history: [
      { role: 'assistant', text: 'Earlier answer' },
      {
        role: 'user',
        text: 'Earlier question',
        contextUpdate: {
          transcriptText: '[2026-07-19] Them: update one',
          records: [
            {
              kind: 'correction',
              targetReference: 'message-1',
              replacementText: 'corrected',
            },
          ],
        },
      },
    ],
    currentQuestion: 'How did the attitude change?',
    currentContextUpdate: {
      transcriptText: '[2026-07-20] Them: update two',
      records: [{ kind: 'tombstone', targetReference: 'message-2', state: 'deleted' }],
    },
    ...overrides,
  };
}

function streamingClient(
  implementation: NonNullable<LlmGenerateClient['generateChatStream']>
): LlmGenerateClient {
  return {
    generate: vi.fn(
      (): ReturnType<LlmGenerateClient['generate']> =>
        Promise.resolve(err({ code: 'API_ERROR' as const, message: 'not used' }))
    ),
    generateChatStream: vi.fn(implementation),
  };
}

function factoryFor(client: LlmGenerateClient): ConversationAssistantLlmClientFactory {
  return {
    createLlmClientForUser: vi.fn(async () => ok(client)),
  };
}

describe('createConversationAssistantTurnRunner', () => {
  it('builds Prompt V5 only from the immutable snapshot and streams answer deltas in order', async () => {
    let capturedMessages: LlmChatMessage[] | undefined;
    let capturedOptions:
      | Parameters<NonNullable<LlmGenerateClient['generateChatStream']>>[1]
      | undefined;
    const client = streamingClient(async (messages, options, onEvent) => {
      capturedMessages = messages;
      capturedOptions = options;
      onEvent({ type: 'delta', text: 'The tone ' });
      onEvent({ type: 'usage', usage: USAGE });
      onEvent({ type: 'delta', text: 'became warmer.' });
      return ok({ content: 'The tone became warmer.', usage: USAGE });
    });
    const factory = factoryFor(client);
    const runner = createConversationAssistantTurnRunner({ llmClientFactory: factory });
    const input = snapshot();
    const deltas: string[] = [];

    const result = await runner.generateAnswer(input, (text) => deltas.push(text));

    const expectedMessages = buildWhatsAppConversationAssistantMessages({
      transcriptText: input.transcriptText,
      ...(input.chatDisplayName === undefined
        ? {}
        : { chatDisplayName: input.chatDisplayName }),
      range: input.range,
      effectiveRange: input.effectiveRange,
      history: input.history,
      currentTurn: {
        text: input.currentQuestion,
        ...(input.currentContextUpdate === undefined
          ? {}
          : { contextUpdate: input.currentContextUpdate }),
      },
    });
    expect(capturedMessages).toEqual(expectedMessages);
    expect(JSON.stringify(capturedMessages)).toContain('byte-stable\\r\\n\\\\u0000evidence');
    expect(factory.createLlmClientForUser).toHaveBeenCalledWith(input.userId, input.model);
    expect(capturedOptions).toEqual({
      promptType: 'whatsapp-conversation-assistant',
      temperature: 0.2,
      reasoning: { enabled: true },
    });
    expect(JSON.stringify(capturedOptions)).not.toContain(input.sessionId);
    expect(deltas).toEqual(['The tone ', 'became warmer.']);
    expect(result).toEqual(ok({ text: 'The tone became warmer.', usage: USAGE }));
  });

  it('preserves optional snapshot fields without inventing context blocks', async () => {
    let capturedMessages: LlmChatMessage[] = [];
    const client = streamingClient(async (messages) => {
      capturedMessages = messages;
      return ok({ content: 'Answer', usage: USAGE });
    });
    const factory = factoryFor(client);
    const runner = createConversationAssistantTurnRunner({ llmClientFactory: factory });
    const input = snapshot({ history: [{ role: 'user', text: 'Prior question' }] });
    delete input.chatDisplayName;
    delete input.currentContextUpdate;

    await runner.generateAnswer(input, () => undefined);

    expect(capturedMessages).toEqual(
      buildWhatsAppConversationAssistantMessages({
        transcriptText: input.transcriptText,
        range: input.range,
        effectiveRange: input.effectiveRange,
        history: input.history,
        currentTurn: { text: input.currentQuestion },
      })
    );
  });

  it.each([214_215, 443_797, 1_086_886])(
    'allows an observed production transcript of %i UTF-8 bytes',
    async (transcriptBytes) => {
      const client = streamingClient(async () => ok({ content: 'Answer', usage: USAGE }));
      const factory = factoryFor(client);
      const runner = createConversationAssistantTurnRunner({ llmClientFactory: factory });

      const result = await runner.generateAnswer(
        snapshot({ transcriptText: 'x'.repeat(transcriptBytes) }),
        () => undefined
      );

      expect(result.ok).toBe(true);
      expect(factory.createLlmClientForUser).toHaveBeenCalledOnce();
    }
  );

  it('rejects a prompt that exceeds the selected model input budget', async () => {
    const client = streamingClient(async () => ok({ content: 'unused', usage: USAGE }));
    const factory = factoryFor(client);
    const runner = createConversationAssistantTurnRunner({ llmClientFactory: factory });
    const input = snapshot({ transcriptText: 'x'.repeat(2_000_000) });

    const result = await runner.generateAnswer(input, () => undefined);

    expect(result).toEqual(
      err({
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'This update is too large to include in one question.',
      })
    );
    expect(factory.createLlmClientForUser).not.toHaveBeenCalled();
    const messages = buildWhatsAppConversationAssistantMessages({
      transcriptText: input.transcriptText,
      ...(input.chatDisplayName === undefined
        ? {}
        : { chatDisplayName: input.chatDisplayName }),
      range: input.range,
      effectiveRange: input.effectiveRange,
      history: input.history,
      currentTurn: {
        text: input.currentQuestion,
        ...(input.currentContextUpdate === undefined
          ? {}
          : { contextUpdate: input.currentContextUpdate }),
      },
    });
    expect(estimateConversationAssistantTurnPromptTokens(messages)).toBeGreaterThan(
      CONVERSATION_ASSISTANT_TURN_RUNNER_HARD_PROMPT_TOKEN_LIMIT
    );
  });

  it('allows a prompt at or below the hard serialized budget', async () => {
    const client = streamingClient(async () => ok({ content: 'Answer', usage: USAGE }));
    const factory = factoryFor(client);
    const runner = createConversationAssistantTurnRunner({ llmClientFactory: factory });

    const result = await runner.generateAnswer(snapshot(), () => undefined);

    expect(result.ok).toBe(true);
    expect(factory.createLlmClientForUser).toHaveBeenCalledOnce();
  });

  it('uses a conservative two UTF-8 bytes per token estimate', () => {
    const messages: LlmChatMessage[] = [
      {
        role: 'user',
        content: `${'!'.repeat(256)}${Buffer.from('binary-like-context').toString('base64')}`,
      },
    ];

    expect(estimateConversationAssistantTurnPromptTokens(messages)).toBe(
      Math.ceil(Buffer.byteLength(JSON.stringify(messages), 'utf8') / 2)
    );
  });

  it.each([
    ['factory error', 'factory_error'],
    ['factory throw', 'factory_throw'],
    ['missing stream', 'missing_stream'],
    ['provider error', 'provider_error'],
    ['provider throw', 'provider_throw'],
  ] as const)('maps %s to one safe LLM error', async (_label, scenario) => {
    const providerError = err({ code: 'API_ERROR' as const, message: 'private provider detail' });
    const normalClient = streamingClient(async () => {
      if (scenario === 'provider_throw') throw new Error('private provider throw');
      return scenario === 'provider_error'
        ? providerError
        : ok({ content: 'Answer', usage: USAGE });
    });
    const client =
      scenario === 'missing_stream'
        ? ({ generate: normalClient.generate } satisfies LlmGenerateClient)
        : normalClient;
    const factory: ConversationAssistantLlmClientFactory = {
      createLlmClientForUser: vi.fn(
        async (): ReturnType<ConversationAssistantLlmClientFactory['createLlmClientForUser']> => {
          if (scenario === 'factory_throw') throw new Error('private factory throw');
          return scenario === 'factory_error'
            ? err({ code: 'LLM_ERROR' as const, message: 'private factory detail' })
            : ok(client);
        }
      ),
    };
    const runner = createConversationAssistantTurnRunner({ llmClientFactory: factory });

    const result = await runner.generateAnswer(snapshot(), () => undefined);

    expect(result).toEqual(
      err({ code: 'LLM_ERROR', message: 'The answer could not be generated' })
    );
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('keeps a provider context-length rejection actionable', async () => {
    const client = streamingClient(async () =>
      err({ code: 'CONTEXT_LENGTH', message: 'private provider details' })
    );
    const runner = createConversationAssistantTurnRunner({
      llmClientFactory: factoryFor(client),
    });

    await expect(runner.generateAnswer(snapshot(), () => undefined)).resolves.toEqual(
      err({
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'This update is too large to include in one question.',
      })
    );
  });
});
