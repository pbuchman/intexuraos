/**
 * Tests for generateIssueTitle use case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  describe('fallback title generation', () => {
    it('uses fallback when LLM client fails to initialize', async () => {
      fakeUserServiceClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'User service unavailable',
      });

      const result = await generateIssueTitle(
        { description: 'Fix the bug in the login flow', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix the bug in the login flow');
        expect(result.value.issueType).toBe('feature');
      }
    });

    it('logs warning when LLM client fails', async () => {
      fakeUserServiceClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'User service unavailable',
      });

      await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-456' }),
        'Failed to get LLM client, using fallback'
      );
    });

    it('uses fallback when LLM generation fails', async () => {
      fakeLlmClient.setFailure(true, { code: 'API_ERROR', message: 'LLM error' });

      const result = await generateIssueTitle(
        { description: 'Add new feature to dashboard', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Add new feature to dashboard');
      }
    });

    it('uses fallback when JSON parsing fails', async () => {
      fakeLlmClient.setContent('This is not valid JSON');

      const result = await generateIssueTitle(
        { description: 'Improve performance of API', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Improve performance of API');
      }
    });

    it('logs warning when JSON parsing fails', async () => {
      fakeLlmClient.setContent('Invalid JSON here');

      await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ parseError: expect.any(String) }),
        'Failed to parse LLM response as JSON, using fallback'
      );
    });

    it('uses fallback when schema validation fails', async () => {
      fakeLlmClient.setContent('{"title": "", "issueType": "invalid"}');

      const result = await generateIssueTitle(
        { description: 'Update documentation', userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Update documentation');
      }
    });

    it('logs warning when schema validation fails', async () => {
      fakeLlmClient.setContent('{"title": "Valid", "issueType": "unknown_type"}');

      await generateIssueTitle(defaultRequest, {
        userServiceClient: fakeUserServiceClient,
        logger: fakeLogger,
      });

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ zodErrors: expect.any(String) }),
        'LLM returned invalid response format, using fallback'
      );
    });
  });

  describe('fallback title formatting', () => {
    it('extracts first sentence from description', async () => {
      fakeUserServiceClient.setFailure(true, { code: 'API_ERROR', message: 'Unavailable' });

      const result = await generateIssueTitle(
        {
          description: 'First sentence here. Second sentence with more details.',
          userId: 'user-456',
        },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('First sentence here');
      }
    });

    it('extracts first line from multi-line description', async () => {
      fakeUserServiceClient.setFailure(true, { code: 'API_ERROR', message: 'Unavailable' });

      const result = await generateIssueTitle(
        {
          description: 'First line\nSecond line\nThird line',
          userId: 'user-456',
        },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('First line');
      }
    });

    it('truncates long titles to 80 characters with ellipsis', async () => {
      fakeUserServiceClient.setFailure(true, { code: 'API_ERROR', message: 'Unavailable' });

      const longDescription =
        'This is a very long description that exceeds the maximum title length of eighty characters significantly';

      const result = await generateIssueTitle(
        { description: longDescription, userId: 'user-456' },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title.length).toBe(80);
        expect(result.value.title.endsWith('...')).toBe(true);
      }
    });

    it('removes code blocks from fallback title', async () => {
      fakeUserServiceClient.setFailure(true, { code: 'API_ERROR', message: 'Unavailable' });

      const result = await generateIssueTitle(
        {
          description: 'Fix this bug ```js\nconst x = 1;\n``` in the code',
          userId: 'user-456',
        },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).not.toContain('```');
        expect(result.value.title).not.toContain('const x');
      }
    });

    it('removes inline code from fallback title', async () => {
      fakeUserServiceClient.setFailure(true, { code: 'API_ERROR', message: 'Unavailable' });

      const result = await generateIssueTitle(
        {
          description: 'Fix the `handleClick` function issue',
          userId: 'user-456',
        },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).not.toContain('`');
      }
    });

    it('removes URLs from fallback title', async () => {
      fakeUserServiceClient.setFailure(true, { code: 'API_ERROR', message: 'Unavailable' });

      const result = await generateIssueTitle(
        {
          description: 'Check the bug at https://example.com/issue/123 please',
          userId: 'user-456',
        },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).not.toContain('https://');
      }
    });

    it('removes markdown formatting from fallback title', async () => {
      fakeUserServiceClient.setFailure(true, { code: 'API_ERROR', message: 'Unavailable' });

      const result = await generateIssueTitle(
        {
          description: 'Fix the **bold** and _italic_ text',
          userId: 'user-456',
        },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).not.toContain('*');
        expect(result.value.title).not.toContain('_');
      }
    });

    it('returns Code task when description becomes empty after cleaning', async () => {
      fakeUserServiceClient.setFailure(true, { code: 'API_ERROR', message: 'Unavailable' });

      const result = await generateIssueTitle(
        {
          description: '```code only```',
          userId: 'user-456',
        },
        { userServiceClient: fakeUserServiceClient, logger: fakeLogger }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Code task');
      }
    });
  });
});
