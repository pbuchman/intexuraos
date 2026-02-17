/**
 * Tests for generateIssueTitle use case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  generateIssueTitle,
  type GenerateIssueTitleRequest,
} from '../../../domain/useCases/generateIssueTitle.js';
import { FakeUserServiceClient, FakeLlmGenerateClient } from '../../fakes.js';

describe('generateIssueTitle', () => {
  let fakeUserServiceClient: FakeUserServiceClient;
  let fakeLlmClient: FakeLlmGenerateClient;
  const fakeLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    fakeUserServiceClient = new FakeUserServiceClient();
    fakeLlmClient = new FakeLlmGenerateClient();
    fakeUserServiceClient.setLlmClient(fakeLlmClient);
    vi.clearAllMocks();
  });

  afterEach(() => {
    fakeUserServiceClient.reset();
    fakeLlmClient.reset();
  });

  const defaultRequest: GenerateIssueTitleRequest = {
    description: 'Fix the login button that is not working on mobile devices',
    userId: 'user-456',
  };

  describe('successful generation', () => {
    it('generates title from LLM response', async () => {
      fakeLlmClient.setContent('{"title": "Fix login button on mobile", "issueType": "bug"}');

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login button on mobile');
        expect(result.value.issueType).toBe('bug');
      }
    });

    it('handles feature issue type', async () => {
      fakeLlmClient.setContent('{"title": "Add dark mode to settings", "issueType": "feature"}');

      const result = await generateIssueTitle(
        { description: 'I need dark mode support', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.issueType).toBe('feature');
      }
    });

    it('handles refactor issue type', async () => {
      fakeLlmClient.setContent('{"title": "Refactor auth module", "issueType": "refactor"}');

      const result = await generateIssueTitle(
        { description: 'Clean up the authentication module', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.issueType).toBe('refactor');
      }
    });

    it('handles research issue type', async () => {
      fakeLlmClient.setContent('{"title": "Investigate API options", "issueType": "research"}');

      const result = await generateIssueTitle(
        { description: 'Research the best API for payments', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.issueType).toBe('research');
      }
    });

    it('logs generation request', async () => {
      fakeLlmClient.setContent('{"title": "Test title", "issueType": "feature"}');

      await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-456', descriptionLength: expect.any(Number) }),
        'Generating issue title via LLM'
      );
    });

    it('logs generated title', async () => {
      fakeLlmClient.setContent('{"title": "Generated title", "issueType": "feature"}');

      await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Generated title', issueType: 'feature' }),
        'Generated issue title'
      );
    });
  });

  describe('code block handling', () => {
    it('strips markdown code blocks from response', async () => {
      fakeLlmClient.setContent('```json\n{"title": "From code block", "issueType": "feature"}\n```');

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('From code block');
      }
    });

    it('strips code blocks without language identifier', async () => {
      fakeLlmClient.setContent('```\n{"title": "Plain code block", "issueType": "bug"}\n```');

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Plain code block');
      }
    });
  });

  describe('empty description', () => {
    it('returns default title for empty description', async () => {
      const result = await generateIssueTitle(
        { description: '', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Code task');
        expect(result.value.issueType).toBe('feature');
      }
    });

    it('returns default title for whitespace-only description', async () => {
      const result = await generateIssueTitle(
        { description: '   ', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Code task');
      }
    });
  });

  describe('LLM client unavailable', () => {
    it('returns error when LLM client fails to initialize', async () => {
      fakeUserServiceClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'User service unavailable',
      });

      const result = await generateIssueTitle(
        { description: 'Fix the bug in the login flow', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_ERROR');
        expect(result.error.message).toContain('Failed to get LLM client');
      }
    });

    it('logs error when LLM client fails', async () => {
      fakeUserServiceClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'User service unavailable',
      });

      await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(fakeLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-456' }),
        expect.stringContaining('Failed to get LLM client')
      );
    });
  });

  describe('retry behavior', () => {
    it('retries once on LLM generation failure and succeeds', async () => {
      const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };
      fakeLlmClient.setResponseSequence([
        err({ code: 'API_ERROR', message: 'Temporary failure' }),
        ok({ content: '{"title": "Retry succeeded", "issueType": "bug"}', usage }),
      ]);

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Retry succeeded');
        expect(result.value.issueType).toBe('bug');
      }
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 1 }),
        expect.stringContaining('retrying')
      );
    });

    it('returns error after two LLM generation failures', async () => {
      fakeLlmClient.setResponseSequence([
        err({ code: 'API_ERROR', message: 'First failure' }),
        err({ code: 'API_ERROR', message: 'Second failure' }),
      ]);

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_ERROR');
      }
      expect(fakeLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2 }),
        expect.stringContaining('failed after 2 attempts')
      );
    });

    it('retries once on JSON parse failure and succeeds', async () => {
      const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };
      fakeLlmClient.setResponseSequence([
        ok({ content: 'not valid json', usage }),
        ok({ content: '{"title": "Parse retry succeeded", "issueType": "feature"}', usage }),
      ]);

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Parse retry succeeded');
      }
    });

    it('returns error after two JSON parse failures', async () => {
      const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };
      fakeLlmClient.setResponseSequence([
        ok({ content: 'not json 1', usage }),
        ok({ content: 'not json 2', usage }),
      ]);

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
      }
    });

    it('retries once on schema validation failure and succeeds', async () => {
      const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };
      fakeLlmClient.setResponseSequence([
        ok({ content: '{"title": "", "issueType": "invalid"}', usage }),
        ok({ content: '{"title": "Valid title", "issueType": "feature"}', usage }),
      ]);

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Valid title');
      }
    });

    it('returns error after two schema validation failures', async () => {
      const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };
      fakeLlmClient.setResponseSequence([
        ok({ content: '{"title": "", "issueType": "invalid"}', usage }),
        ok({ content: '{"title": "", "issueType": "also-invalid"}', usage }),
      ]);

      const result = await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
      }
    });
  });
});
