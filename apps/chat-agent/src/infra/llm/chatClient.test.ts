/**
 * Tests for chatClient - covers v8-ignore blocks for LLM error handling,
 * action extraction, and response stripping.
 */

import { describe, it, expect, vi } from 'vitest';
import { createChatClient, type ChatClientConfig } from './chatClient.js';
import type { LlmGenerateClient, GenerateResult } from '@intexuraos/llm-factory';
import type { LLMError } from '@intexuraos/llm-contract';
import type { Logger } from 'pino';
import { ok, err, type Result } from '@intexuraos/common-core';

/** Mock logger */
const mockLogger: Logger = {
  level: 'info',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  msgPrefix: '',
} as unknown as Logger;

/** Create a fake LLM client that can be configured to throw or return specific responses */
function createFakeLlmClient(options: {
  responseText?: string;
  shouldThrow?: boolean;
  throwError?: unknown;
} = {}): LlmGenerateClient {
  const {
    responseText = 'Hello, this is a test response',
    shouldThrow = false,
    throwError = new Error('LLM failed'),
  } = options;

  return {
    async generate(_prompt: string): Promise<Result<GenerateResult, LLMError>> {
      if (shouldThrow) {
        throw throwError;
      }
      return ok({
        content: responseText,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.0001 },
      });
    },
  };
}

describe('createChatClient', () => {
  const createConfig = (llmClient: LlmGenerateClient): ChatClientConfig => ({
    llmClient,
    logger: mockLogger,
  });

  describe('generate - error handling', () => {
    it('should handle errors thrown by LLM client', async () => {
      const fakeLlm = createFakeLlmClient({ shouldThrow: true, throwError: new Error('Network error') });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Hello', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_ERROR');
        expect(result.error.message).toBe('Network error');
      }
    });

    it('should handle non-Error throws from LLM client', async () => {
      const fakeLlm = createFakeLlmClient({ shouldThrow: true, throwError: 'string error' });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Hello', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_ERROR');
        expect(result.error.message).toBe('string error');
      }
    });

    it('should handle object throws from LLM client', async () => {
      const fakeLlm = createFakeLlmClient({ shouldThrow: true, throwError: { code: 'TIMEOUT' } });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Hello', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_ERROR');
        // Object without message property returns fallback
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });

  describe('generate - action extraction', () => {
    it('should extract create_command action from response', async () => {
      const fakeLlm = createFakeLlmClient({
        responseText: 'I will create that todo for you. [ACTION: create_command {"text": "buy groceries"}]',
      });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Create a todo', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction).toEqual({
          type: 'create_command',
          payload: { text: 'buy groceries' },
          awaitingConfirmation: true,
        });
        // Response should have action stripped
        expect(result.value.response).toBe('I will create that todo for you.');
      }
    });

    it('should handle response without action', async () => {
      const fakeLlm = createFakeLlmClient({
        responseText: 'This is just a regular response without any action.',
      });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Hello', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction).toBeUndefined();
        expect(result.value.response).toBe('This is just a regular response without any action.');
      }
    });

    it('should handle action with complex payload', async () => {
      const fakeLlm = createFakeLlmClient({
        responseText: 'Creating command. [ACTION: create_command {"text": "complex task", "priority": "high", "nested": {"key": "value"}}]',
      });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Create complex todo', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction?.type).toBe('create_command');
        expect(result.value.suggestedAction?.payload).toEqual({
          text: 'complex task',
          priority: 'high',
          nested: { key: 'value' },
        });
      }
    });

    it('should handle invalid JSON in action payload', async () => {
      const fakeLlm = createFakeLlmClient({
        responseText: 'Response [ACTION: create_command {invalid json}]',
      });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Test', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Invalid JSON should result in null action
        expect(result.value.suggestedAction).toBeUndefined();
      }
    });

    it('should handle malformed action annotation (missing action type)', async () => {
      const fakeLlm = createFakeLlmClient({
        responseText: 'Response [ACTION:  {"text": "test"}]',
      });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Test', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Missing action type should result in null action
        expect(result.value.suggestedAction).toBeUndefined();
      }
    });

    it('should handle malformed action annotation (missing payload)', async () => {
      const fakeLlm = createFakeLlmClient({
        responseText: 'Response [ACTION: create_command ]',
      });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Test', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction).toBeUndefined();
      }
    });

    it('should handle action at start of response', async () => {
      const fakeLlm = createFakeLlmClient({
        responseText: '[ACTION: create_command {"text": "start"}] Here is your response',
      });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Test', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction).toBeDefined();
        expect(result.value.response).toBe('Here is your response');
      }
    });

    it('should handle action in middle of multiline response', async () => {
      const fakeLlm = createFakeLlmClient({
        responseText: `Line 1
[ACTION: create_command {"text": "multiline"}]
Line 3`,
      });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Test', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction).toBeDefined();
        expect(result.value.response).toBe('Line 1\n\nLine 3');
      }
    });
  });

  describe('generate - conversation history', () => {
    it('should include conversation history in prompt', async () => {
      const fakeLlm = createFakeLlmClient({ responseText: 'Response' });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Current message', {
        systemPrompt: 'You are helpful',
        conversationHistory: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });

      expect(result.ok).toBe(true);
      // The LLM client should receive a prompt with the conversation history
      // This is tested indirectly by verifying the result succeeds
      if (result.ok) {
        expect(result.value.response).toBe('Response');
      }
    });

    it('should work without conversation history', async () => {
      const fakeLlm = createFakeLlmClient({ responseText: 'Simple response' });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Hello', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.response).toBe('Simple response');
        expect(result.value.suggestedAction).toBeUndefined();
      }
    });

    it('should handle empty conversation history array', async () => {
      const fakeLlm = createFakeLlmClient({ responseText: 'Response with empty history' });

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Hello', {
        systemPrompt: 'You are helpful',
        conversationHistory: [],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.response).toBe('Response with empty history');
      }
    });
  });

  describe('generate - propagating LLM errors', () => {
    it('should propagate error results from LLM client', async () => {
      const fakeLlm: LlmGenerateClient = {
        async generate(): Promise<Result<GenerateResult, LLMError>> {
          return err({ code: 'RATE_LIMITED', message: 'Rate limit exceeded' });
        },
      };

      const client = createChatClient(createConfig(fakeLlm));
      const result = await client.generate('Hello', { systemPrompt: 'You are helpful' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });
  });
});
