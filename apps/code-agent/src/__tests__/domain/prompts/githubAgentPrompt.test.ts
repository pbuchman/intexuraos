/**
 * Tests for GitHub Agent prompt builder.
 */

import { describe, it, expect } from 'vitest';
import { githubAgentPrompt } from '../../../domain/prompts/githubAgentPrompt.js';

describe('githubAgentPrompt', () => {
  describe('PR section', () => {
    it('builds prompt with files and body', () => {
      const result = githubAgentPrompt.build({
        repository: 'owner/repo',
        prNumber: 1,
        prTitle: 'test PR',
        prBody: 'This is a test PR',
        action: 'opened',
        senderLogin: 'user',
        eventType: 'pull_request',
        files: [{ filename: 'src/index.ts', status: 'modified', additions: 10, deletions: 5 }],
      });

      expect(result).toContain('This is a test PR');
      expect(result).toContain('src/index.ts');
    });

    it('shows (no description) when prBody is empty', () => {
      const result = githubAgentPrompt.build({
        repository: 'owner/repo',
        prNumber: 1,
        prTitle: 'test PR',
        prBody: '',
        action: 'opened',
        senderLogin: 'user',
        eventType: 'pull_request',
        files: [],
      });

      expect(result).toContain('(no description)');
    });

    it('shows (no files) when files array is empty', () => {
      const result = githubAgentPrompt.build({
        repository: 'owner/repo',
        prNumber: 1,
        prTitle: 'test PR',
        prBody: 'body',
        action: 'opened',
        senderLogin: 'user',
        eventType: 'pull_request',
        files: [],
      });

      expect(result).toContain('(no files)');
    });

    it('defaults files to empty array when undefined', () => {
      const result = githubAgentPrompt.build({
        repository: 'owner/repo',
        prNumber: 1,
        prTitle: 'test PR',
        prBody: 'body',
        action: 'opened',
        senderLogin: 'user',
        eventType: 'pull_request',
      });

      expect(result).toContain('(no files)');
    });
  });

  describe('comment section', () => {
    it('builds prompt with comment fields', () => {
      const result = githubAgentPrompt.build({
        repository: 'owner/repo',
        prNumber: 1,
        prTitle: 'test PR',
        prBody: '',
        action: 'created',
        senderLogin: 'user',
        eventType: 'issue_comment',
        commentBody: 'Fix the lint',
        isEdit: false,
        isBotSender: false,
      });

      expect(result).toContain('Fix the lint');
      expect(result).toContain('Comment Triage');
    });

    it('defaults optional comment fields when undefined', () => {
      const result = githubAgentPrompt.build({
        repository: 'owner/repo',
        prNumber: 1,
        prTitle: 'test PR',
        prBody: '',
        action: 'created',
        senderLogin: 'user',
        eventType: 'issue_comment',
      });

      expect(result).toContain('Comment Triage');
      expect(result).toContain('created');
    });
  });
});
