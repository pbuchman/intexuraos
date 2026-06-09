/**
 * Tests for GitHub Agent prompt builder.
 */

import { describe, it, expect } from 'vitest';
import { githubAgentPrompt } from '../../../domain/prompts/githubAgentPrompt.js';

describe('githubAgentPrompt', () => {
  it('has version 6.0.0', () => {
    expect(githubAgentPrompt.version).toBe('6.0.0');
  });

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

    it('contains hard gate against duplicate tool calls', () => {
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

      expect(result).toContain('HARD RULES');
      expect(result).toContain('NEVER call the same tool with the same arguments more than once');
      expect(result).toContain('Duplicate tool calls are a critical error');
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

    it('contains test_quality review type guideline with key phrases', () => {
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

      expect(result).toContain('test_quality');
      expect(result).toContain('false positives');
      expect(result).toContain('v8 ignore');
    });

    it('contains documentation review guidance and does not tell docs-only PRs to skip', () => {
      const result = githubAgentPrompt.build({
        repository: 'owner/repo',
        prNumber: 1,
        prTitle: 'docs update',
        prBody: 'body',
        action: 'opened',
        senderLogin: 'user',
        eventType: 'pull_request',
        files: [{ filename: 'README.md', status: 'modified', additions: 3, deletions: 1 }],
      });

      expect(result).toContain('documentation');
      expect(result).toContain('Docs-only PR');
      expect(result).toContain('request_review({"review_type":"documentation"})');
      expect(result).not.toContain('documentation-only change, no code to review');
    });

    it('describes existing review scopes with dispatch criteria', () => {
      const result = githubAgentPrompt.build({
        repository: 'owner/repo',
        prNumber: 1,
        prTitle: 'feature',
        prBody: 'body',
        action: 'opened',
        senderLogin: 'user',
        eventType: 'pull_request',
        files: [],
      });

      expect(result).toContain('source files or implementation behavior');
      expect(result).toContain('auth, authorization, secrets, tokens, user input');
      expect(result).toContain('cross-service');
      expect(result).toContain('false positives');
    });

    it('includes Example 4 showing test-heavy PR dispatch', () => {
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

      expect(result).toContain('Example 4');
      expect(result).toContain('test_quality');
      expect(result).toContain('test-heavy PR');
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
