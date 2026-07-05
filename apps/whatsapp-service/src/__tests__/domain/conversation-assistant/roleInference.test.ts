import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  GenerateChatResult,
  GenerateResult,
  LlmGenerateClient,
  LLMError,
} from '@intexuraos/llm-factory';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
  inferConversationAssistantRoleLabel,
  normalizeConversationAssistantRoleLabel,
} from '../../../domain/conversation-assistant/roleInference.js';

const zeroUsage: GenerateResult['usage'] = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

class FakeGenerateClient implements LlmGenerateClient {
  readonly prompts: { prompt: string; promptType: string }[] = [];

  constructor(private readonly responses: Promise<Result<GenerateResult, LLMError>>[]) {}

  async generate(
    prompt: string,
    options: { promptType: string }
  ): Promise<Result<GenerateResult, LLMError>> {
    this.prompts.push({ prompt, promptType: options.promptType });
    return await (this.responses.shift() ??
      Promise.resolve(
        ok({
          content: '{"roleLabel":"Assistant","confidence":0.1,"rationale":"fallback"}',
          usage: zeroUsage,
        })
      ));
  }

  generateChat?(): Promise<Result<GenerateChatResult, LLMError>> {
    throw new Error('generateChat not implemented');
  }
}

describe('inferConversationAssistantRoleLabel', () => {
  it('returns Assistant without calling the LLM when the initial question is blank', async () => {
    const client = new FakeGenerateClient([]);

    const label = await inferConversationAssistantRoleLabel({
      initialQuestion: '  ',
      client,
      model: 'or:minimax/minimax-m3',
      sessionId: 'session-1',
    });

    expect(label).toBe(DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL);
    expect(client.prompts).toHaveLength(0);
  });

  it('accepts a high-confidence profession that is not from a fixed enum', async () => {
    const client = new FakeGenerateClient([
      Promise.resolve(
        ok({
          content:
            '{"roleLabel":"marine surveyor","confidence":0.93,"rationale":"The user asks about a boat inspection."}',
          usage: zeroUsage,
        })
      ),
    ]);

    const label = await inferConversationAssistantRoleLabel({
      initialQuestion: 'Can you review this boat survey before I buy it?',
      client,
      model: 'or:minimax/minimax-m3',
      sessionId: 'session-1',
    });

    expect(label).toBe('Marine Surveyor');
  });

  it('falls back to Assistant on API failure', async () => {
    const client = new FakeGenerateClient([
      Promise.resolve(err({ code: 'API_ERROR', message: 'down' } as LLMError)),
    ]);

    await expect(
      inferConversationAssistantRoleLabel({
        initialQuestion: 'Can I sue my employer?',
        client,
        model: 'or:minimax/minimax-m3',
        sessionId: 'session-1',
      })
    ).resolves.toBe(DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL);
  });

  it('falls back to Assistant when the classifier confidence is too low', async () => {
    const client = new FakeGenerateClient([
      Promise.resolve(
        ok({
          content:
            '{"roleLabel":"Tax Advisor","confidence":0.59,"rationale":"The question is only weakly tax-related."}',
          usage: zeroUsage,
        })
      ),
    ]);

    await expect(
      inferConversationAssistantRoleLabel({
        initialQuestion: 'Maybe this has something to do with taxes?',
        client,
        model: 'or:minimax/minimax-m3',
        sessionId: 'session-1',
      })
    ).resolves.toBe(DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL);
  });

  it('falls back to Assistant after malformed JSON and failed repair', async () => {
    const client = new FakeGenerateClient([
      Promise.resolve(ok({ content: 'not json', usage: zeroUsage })),
      Promise.resolve(
        ok({ content: '{"roleLabel":"","confidence":2,"rationale":""}', usage: zeroUsage })
      ),
    ]);

    await expect(
      inferConversationAssistantRoleLabel({
        initialQuestion: 'What does this MRI note mean?',
        client,
        model: 'or:minimax/minimax-m3',
        sessionId: 'session-1',
      })
    ).resolves.toBe(DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL);
    expect(client.prompts).toHaveLength(2);
  });

  it('normalizes and rejects unsafe labels', () => {
    expect(normalizeConversationAssistantRoleLabel('  software engineer  ')).toBe(
      'Software Engineer'
    );
    expect(normalizeConversationAssistantRoleLabel('Employment Lawyer')).toBe(
      'Employment Lawyer'
    );
    expect(normalizeConversationAssistantRoleLabel('Marine Surveyor')).toBe('Marine Surveyor');
    expect(normalizeConversationAssistantRoleLabel('Data Scientist')).toBe('Data Scientist');
    expect(normalizeConversationAssistantRoleLabel('Tax Advisor')).toBe('Tax Advisor');
    expect(normalizeConversationAssistantRoleLabel('tax advisor/consultant')).toBe(
      'Tax Advisor/Consultant'
    );
    expect(normalizeConversationAssistantRoleLabel('career-coach')).toBe('Career-Coach');
    expect(normalizeConversationAssistantRoleLabel('strategy & planning advisor')).toBe(
      'Strategy & Planning Advisor'
    );
    expect(normalizeConversationAssistantRoleLabel('Alice Smith')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Dr. Alice Smith')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('123')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Acme Legal Group')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Licensed Psychologist')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Certified Tax Advisor')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Jane Doe, PhD')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('**Lawyer**')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Assistant')).toBe('Assistant');
  });
});
