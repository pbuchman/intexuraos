import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLinearIssueService } from '../../../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';

describe('linearIssueService', () => {
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  let mockCreateIssue = vi.fn();
  let mockUpdateIssueState = vi.fn();
  let mockValidateIssue = vi.fn();
  let mockGenerateTitle = vi.fn();
  let mockAddComment = vi.fn();
  let mockFetchIssueTree = vi.fn();
  let mockUpdateIssueMetadata = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateIssue = vi.fn();
    mockUpdateIssueState = vi.fn();
    mockValidateIssue = vi.fn();
    mockGenerateTitle = vi.fn();
    mockAddComment = vi.fn();
    mockFetchIssueTree = vi.fn();
    mockUpdateIssueMetadata = vi.fn();
  });

  const mockClient: LinearAgentClient = {
    createIssue: (...args: Parameters<LinearAgentClient['createIssue']>) => mockCreateIssue(...args),
    updateIssueState: (...args: Parameters<LinearAgentClient['updateIssueState']>) => mockUpdateIssueState(...args),
    validateIssue: (...args: Parameters<LinearAgentClient['validateIssue']>) => mockValidateIssue(...args),
    generateTitle: (...args: Parameters<LinearAgentClient['generateTitle']>) => mockGenerateTitle(...args),
    addComment: (...args: Parameters<LinearAgentClient['addComment']>) => mockAddComment(...args),
    fetchIssueTree: (...args: Parameters<LinearAgentClient['fetchIssueTree']>) => mockFetchIssueTree(...args),
    updateIssueMetadata: (...args: Parameters<LinearAgentClient['updateIssueMetadata']>) => mockUpdateIssueMetadata(...args),
    fetchIssueForDisplay: vi.fn(),
    fetchIssuesForDisplay: vi.fn(),
    getIssueDescription: vi.fn(),
    getIssueContext: vi.fn(),
  };

  const testUserId = 'test-user-123';

  describe('ensureIssueExists - link existing issue', () => {
    it('should validate and return existing issue when valid', async () => {
      mockValidateIssue = vi.fn().mockResolvedValue(
        ok({
          id: 'issue-123',
          identifier: 'INT-123',
          title: 'Fix auth bug',
          url: 'https://linear.app/intexuraos/INT-123',
          labels: [],
          childCount: 0,
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        linearIssueId: 'INT-123',
        taskPrompt: 'Work on existing issue',
      });

      expect(result).toEqual({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix auth bug',
        linearIssueUrl: 'https://linear.app/intexuraos/INT-123',
        linearFallback: false,
        linearIssueLabels: [],
        hasChildren: false,
      });
      expect(mockValidateIssue).toHaveBeenCalledWith({
        userId: testUserId,
        identifier: 'INT-123',
      });
      expect(mockCreateIssue).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { linearIssueId: 'INT-123' },
        'Validating existing Linear issue'
      );
    });

    it('should use fallback mode when validation fails (NOT_FOUND)', async () => {
      mockValidateIssue = vi.fn().mockResolvedValue(
        err({
          code: 'NOT_FOUND',
          message: 'Issue INT-999 not found',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        linearIssueId: 'INT-999',
        taskPrompt: 'Work on issue',
      });

      expect(result.linearFallback).toBe(true);
      expect(result.linearIssueId).toBeUndefined();
      expect(result.linearIssueTitle).toBe('Linked issue INT-999');
      expect(result.linearFallbackError).toBe('Issue INT-999 not found');
      expect(mockCreateIssue).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { linearIssueId: 'INT-999', error: { code: 'NOT_FOUND', message: 'Issue INT-999 not found' } },
        'Issue validation failed, using fallback mode'
      );
    });

    it('should use fallback mode when validation fails (NOT_FOUND for wrong team)', async () => {
      mockValidateIssue = vi.fn().mockResolvedValue(
        err({
          code: 'NOT_FOUND',
          message: 'Issue OTHER-42 not found or belongs to different team',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        linearIssueId: 'OTHER-42',
        taskPrompt: 'Work on issue',
      });

      expect(result.linearFallback).toBe(true);
      expect(mockCreateIssue).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'NOT_FOUND' }) }),
        'Issue validation failed, using fallback mode'
      );
    });

    it('should use fallback mode when validation fails (UNAVAILABLE)', async () => {
      mockValidateIssue = vi.fn().mockResolvedValue(
        err({
          code: 'UNAVAILABLE',
          message: 'Service unavailable',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        linearIssueId: 'INT-123',
        taskPrompt: 'Work on issue',
      });

      expect(result.linearFallback).toBe(true);
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });
  });

  describe('ensureIssueExists - create new issue', () => {
    it('should generate title via LLM and create new issue', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        ok({
          title: 'Fix login authentication for SSO users',
          issueType: 'bug',
        })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'new-456',
          issueIdentifier: 'INT-456',
          issueTitle: 'Fix login authentication for SSO users',
          issueUrl: 'https://linear.app/pbuchman/issue/INT-456',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Fix the login bug in the auth module',
      });

      expect(result).toEqual({
        linearIssueId: 'INT-456',
        linearIssueTitle: 'Fix login authentication for SSO users',
        linearIssueUrl: 'https://linear.app/pbuchman/issue/INT-456',
        linearIssueType: 'bug',
        linearFallback: false,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(mockGenerateTitle).toHaveBeenCalledWith({
        userId: testUserId,
        description: 'Fix the login bug in the auth module',
      });

      expect(mockCreateIssue).toHaveBeenCalledWith({
        title: 'Fix login authentication for SSO users',
        description: expect.stringContaining('Fix the login bug in the auth module'),
        userId: testUserId,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { title: 'Fix login authentication for SSO users', issueType: 'bug' },
        'Generated issue title via LLM'
      );
    });

    it('should create feature type issue when LLM classifies as feature', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        ok({
          title: 'Enable real-time notifications',
          issueType: 'feature',
        })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'feat-1',
          issueIdentifier: 'INT-500',
          issueTitle: 'Enable real-time notifications',
          issueUrl: 'https://linear.app/intexuraos/INT-500',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Add WebSocket support for notifications',
      });

      expect(result.linearIssueType).toBe('feature');
      expect(result.linearIssueTitle).toBe('Enable real-time notifications');
    });

    it('should create refactor type issue when LLM classifies as refactor', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        ok({
          title: 'Improve test coverage for user management',
          issueType: 'refactor',
        })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'refactor-1',
          issueIdentifier: 'INT-501',
          issueTitle: 'Improve test coverage for user management',
          issueUrl: 'https://linear.app/intexuraos/INT-501',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Refactor user service to use repository pattern',
      });

      expect(result.linearIssueType).toBe('refactor');
    });

    it('should create research type issue when LLM classifies as research', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        ok({
          title: 'Evaluate caching strategies for API performance',
          issueType: 'research',
        })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'research-1',
          issueIdentifier: 'INT-502',
          issueTitle: 'Evaluate caching strategies for API performance',
          issueUrl: 'https://linear.app/intexuraos/INT-502',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Research caching options',
      });

      expect(result.linearIssueType).toBe('research');
    });

    it('should use truncated prompt as title when LLM generation fails', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        err({
          code: 'UNAVAILABLE',
          message: 'LLM service down',
        })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'fallback-1',
          issueIdentifier: 'INT-600',
          issueTitle: 'Fix the bug in auth module',
          issueUrl: 'https://linear.app/intexuraos/INT-600',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Fix the bug in auth module',
      });

      expect(result.linearIssueType).toBe('feature');
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Fix the bug in auth module',
        })
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: { code: 'UNAVAILABLE', message: 'LLM service down' } },
        'LLM title generation failed, using raw prompt'
      );
    });

    it('should truncate long prompt to 80 chars when LLM generation fails', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'LLM service down' })
      );

      const longPrompt = 'This is a very long description that exceeds the maximum title length of eighty characters significantly';

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'fallback-2',
          issueIdentifier: 'INT-601',
          issueTitle: longPrompt.slice(0, 77) + '...',
          issueUrl: 'https://linear.app/intexuraos/INT-601',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: longPrompt,
      });

      expect(result.linearIssueType).toBe('feature');
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/\.\.\.$/),
        })
      );
      const firstCall = mockCreateIssue.mock.calls[0] as [{ title: string }];
      expect(firstCall[0].title.length).toBe(80);
    });

    it('should use Code task when prompt is empty and LLM generation fails', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'LLM service down' })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'fallback-3',
          issueIdentifier: 'INT-602',
          issueTitle: 'Code task',
          issueUrl: 'https://linear.app/intexuraos/INT-602',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: '',
      });

      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Code task',
        })
      );
      expect(result.linearIssueType).toBe('feature');
    });

    it('should use fallback mode when issue creation fails', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        ok({
          title: 'Generated Title',
          issueType: 'bug',
        })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        err({
          code: 'UNAVAILABLE',
          message: 'Service down',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Fix the bug',
      });

      expect(result.linearFallback).toBe(true);
      expect(result.linearIssueId).toBeUndefined();
      expect(result.linearIssueTitle).toBe('Generated Title');
      expect(result.linearIssueType).toBe('bug');
      expect(result.linearFallbackError).toBe('Service down');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        { error: { code: 'UNAVAILABLE', message: 'Service down' } },
        'Failed to create Linear issue, using fallback mode'
      );
    });

    it('should handle empty taskPrompt gracefully', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        ok({
          title: 'Code task',
          issueType: 'feature',
        })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'empty-1',
          issueIdentifier: 'INT-700',
          issueTitle: 'Code task',
          issueUrl: 'https://linear.app/intexuraos/INT-700',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: '',
      });

      expect(result.linearIssueId).toBe('INT-700');
      expect(mockCreateIssue).toHaveBeenCalled();
    });

    it('should return empty labels for auto-created issues to ensure planning agent is entered', async () => {
      mockGenerateTitle = vi.fn().mockResolvedValue(
        ok({ title: 'Some Feature', issueType: 'feature' as const })
      );

      mockCreateIssue = vi.fn().mockResolvedValue(
        ok({
          issueId: 'phase-check-1',
          issueIdentifier: 'INT-999',
          issueTitle: 'Some Feature',
          issueUrl: 'https://linear.app/intexuraos/INT-999',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Do something',
      });

      // Auto-created issues MUST have no labels so processCodeAction routes to planning agent
      expect(result.linearIssueLabels).toEqual([]);
      // Verify the code-task label was not passed to the Linear API
      expect(mockCreateIssue).not.toHaveBeenCalledWith(
        expect.objectContaining({ labels: expect.arrayContaining(['Code Task']) })
      );
    });
  });

  describe('markInProgress', () => {
    it('should call updateIssueState with in_progress', async () => {
      mockUpdateIssueState = vi.fn().mockResolvedValue(ok(undefined));

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await service.markInProgress(testUserId, 'issue-123');

      expect(mockUpdateIssueState).toHaveBeenCalledWith({
        userId: 'test-user-123',
        issueId: 'issue-123',
        state: 'in_progress',
      });
    });

    it('should skip state transition when no issue ID provided', async () => {
      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await service.markInProgress(testUserId, '');

      expect(mockUpdateIssueState).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        {},
        'Skipping state transition (no issue ID)'
      );
    });

    it('should log warning and continue on failure', async () => {
      mockUpdateIssueState = vi.fn().mockResolvedValue(
        err({
          code: 'UNAVAILABLE',
          message: 'Service down',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await expect(service.markInProgress(testUserId, 'issue-123')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          linearIssueId: 'issue-123',
          error: { code: 'UNAVAILABLE', message: 'Service down' },
        },
        'Failed to update Linear issue to In Progress'
      );
    });
  });

  describe('markInReview', () => {
    it('should call updateIssueState with in_review', async () => {
      mockUpdateIssueState = vi.fn().mockResolvedValue(ok(undefined));

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await service.markInReview(testUserId, 'issue-123');

      expect(mockUpdateIssueState).toHaveBeenCalledWith({
        userId: 'test-user-123',
        issueId: 'issue-123',
        state: 'in_review',
      });
    });

    it('should skip state transition when no issue ID provided', async () => {
      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await service.markInReview(testUserId, '');

      expect(mockUpdateIssueState).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        {},
        'Skipping state transition (no issue ID)'
      );
    });

    it('should log warning and continue on failure', async () => {
      mockUpdateIssueState = vi.fn().mockResolvedValue(
        err({
          code: 'UNAVAILABLE',
          message: 'Service down',
        })
      );

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await expect(service.markInReview(testUserId, 'issue-123')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          linearIssueId: 'issue-123',
          error: { code: 'UNAVAILABLE', message: 'Service down' },
        },
        'Failed to update Linear issue to In Review'
      );
    });
  });
});
