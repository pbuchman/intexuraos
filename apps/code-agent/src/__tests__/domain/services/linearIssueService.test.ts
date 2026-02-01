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

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateIssue = vi.fn();
    mockUpdateIssueState = vi.fn();
  });

  const mockClient: LinearAgentClient = {
    createIssue: (...args: Parameters<LinearAgentClient['createIssue']>) => mockCreateIssue(...args),
    updateIssueState: (...args: Parameters<LinearAgentClient['updateIssueState']>) => mockUpdateIssueState(...args),
  };

  const testUserId = 'test-user-123';

  describe('ensureIssueExists', () => {
    it('should return existing issue when linearIssueId and title provided', async () => {
      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        linearIssueId: 'existing-123',
        linearIssueTitle: 'Existing Issue',
        taskPrompt: 'Fix the bug',
      });

      expect(result).toEqual({
        linearIssueId: 'existing-123',
        linearIssueTitle: 'Existing Issue',
        linearFallback: false,
      });
      expect(mockCreateIssue).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { linearIssueId: 'existing-123' },
        'Using existing Linear issue'
      );
    });

    it('should return existing issue with fallback title when only linearIssueId provided', async () => {
      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        linearIssueId: 'INT-999',
        taskPrompt: 'Work on existing issue',
      });

      expect(result).toEqual({
        linearIssueId: 'INT-999',
        linearIssueTitle: 'Linked issue INT-999',
        linearFallback: false,
      });
      expect(mockCreateIssue).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { linearIssueId: 'INT-999' },
        'Using existing Linear issue'
      );
    });

    it('should create new issue when linearIssueId not provided', async () => {
      const mockIssueResponse = {
        issueId: 'new-456',
        issueIdentifier: 'INT-456',
        issueTitle: 'Fix the login bug',
        issueUrl: 'https://linear.app/intexuraos/issue/INT-456',
      };

      mockCreateIssue = vi.fn().mockResolvedValue(ok(mockIssueResponse));

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Fix the login bug in the auth module',
      });

      expect(result).toEqual({
        linearIssueId: 'INT-456',
        linearIssueTitle: 'Fix the login bug',
        linearFallback: false,
      });
      expect(mockCreateIssue).toHaveBeenCalledWith({
        title: 'Fix the login bug in the auth module',
        description: expect.stringContaining('Code Task'),
        labels: ['Code Task'],
        userId: 'test-user-123',
      });
      expect(mockCreateIssue).toHaveBeenCalledWith({
        title: 'Fix the login bug in the auth module',
        description: expect.stringContaining('Fix the login bug in the auth module'),
        labels: ['Code Task'],
        userId: 'test-user-123',
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        {},
        'Creating new Linear issue for code task'
      );
    });

    it('should use fallback mode when Linear unavailable', async () => {
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
      expect(result.linearIssueTitle).toBe('Fix the bug');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { error: { code: 'UNAVAILABLE', message: 'Service down' } },
        'Failed to create Linear issue, using fallback mode'
      );
    });

    it('should generate title from prompt when creating issue', async () => {
      const mockIssueResponse = {
        issueId: 'new-789',
        issueIdentifier: 'INT-789',
        issueTitle: 'Generated Title',
        issueUrl: 'https://linear.app/intexuraos/issue/INT-789',
      };

      mockCreateIssue = vi.fn().mockResolvedValue(ok(mockIssueResponse));

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Fix the bug in auth module',
      });

      expect(mockCreateIssue).toHaveBeenCalledWith({
        title: 'Fix the bug in auth module',
        description: expect.stringContaining('Fix the bug in auth module'),
        labels: ['Code Task'],
        userId: 'test-user-123',
      });
    });

    it('should handle empty taskPrompt gracefully', async () => {
      const mockIssueResponse = {
        issueId: 'new-empty',
        issueIdentifier: 'INT-999',
        issueTitle: 'Code task',
        issueUrl: 'https://linear.app/intexuraos/issue/INT-999',
      };

      mockCreateIssue = vi.fn().mockResolvedValue(ok(mockIssueResponse));

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const result = await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: '',
      });

      expect(result.linearIssueId).toBe('INT-999');
      expect(mockCreateIssue).toHaveBeenCalled();
    });

    it('should truncate long prompts to 80 chars for title', async () => {
      const mockIssueResponse = {
        issueId: 'new-long',
        issueIdentifier: 'INT-888',
        issueTitle: 'This is a very long prompt that exceeds eighty characters and should be...',
        issueUrl: 'https://linear.app/intexuraos/issue/INT-888',
      };

      mockCreateIssue = vi.fn().mockResolvedValue(ok(mockIssueResponse));

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      const longPrompt = 'This is a very long prompt that exceeds eighty characters and should be truncated appropriately for the issue title';

      await service.ensureIssueExists({ userId: testUserId, taskPrompt: longPrompt });

      expect(mockCreateIssue).toHaveBeenCalled();
      // Verify the title was truncated to 80 chars by checking the generated title matches pattern
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/^.{80}$/),
        })
      );
    });

    it('should remove code blocks from title', async () => {
      const mockIssueResponse = {
        issueId: 'new-code',
        issueIdentifier: 'INT-777',
        issueTitle: 'Fix the bug',
        issueUrl: 'https://linear.app/intexuraos/issue/INT-777',
      };

      mockCreateIssue = vi.fn().mockResolvedValue(ok(mockIssueResponse));

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: '```typescript\nconst x = 1;\n```\n\nFix the bug in the auth module',
      });

      expect(mockCreateIssue).toHaveBeenCalled();
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.not.stringContaining('```'),
        })
      );
    });

    it('should remove URLs from title', async () => {
      const mockIssueResponse = {
        issueId: 'new-url',
        issueIdentifier: 'INT-666',
        issueTitle: 'Fix the bug',
        issueUrl: 'https://linear.app/intexuraos/issue/INT-666',
      };

      mockCreateIssue = vi.fn().mockResolvedValue(ok(mockIssueResponse));

      const service = createLinearIssueService({ linearAgentClient: mockClient, logger: mockLogger });

      await service.ensureIssueExists({
        userId: testUserId,
        taskPrompt: 'Check https://example.com/docs and Fix the bug',
      });

      expect(mockCreateIssue).toHaveBeenCalled();
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.not.stringContaining('https://'),
        })
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
