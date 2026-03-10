/**
 * Tests for issue comment triage prompt section.
 */

import { describe, it, expect } from 'vitest';
import { buildIssueCommentTriageSection } from '../../../domain/prompts/issueCommentTriagePrompt.js';

describe('buildIssueCommentTriageSection', () => {
  it('includes comment body when non-empty', () => {
    const result = buildIssueCommentTriageSection({
      commentBody: 'Fix the lint',
      isEdit: false,
      isBotSender: false,
      senderLogin: 'user',
    });

    expect(result).toContain('Fix the lint');
    expect(result).not.toContain('(empty comment)');
  });

  it('shows (empty comment) when commentBody is empty string', () => {
    const result = buildIssueCommentTriageSection({
      commentBody: '',
      isEdit: false,
      isBotSender: false,
      senderLogin: 'user',
    });

    expect(result).toContain('(empty comment)');
  });

  it('shows (bot) suffix for bot senders', () => {
    const result = buildIssueCommentTriageSection({
      commentBody: 'Review complete',
      isEdit: false,
      isBotSender: true,
      senderLogin: 'claude[bot]',
    });

    expect(result).toContain('(bot)');
  });

  it('shows edited action when isEdit is true', () => {
    const result = buildIssueCommentTriageSection({
      commentBody: 'Updated review',
      isEdit: true,
      isBotSender: false,
      senderLogin: 'user',
    });

    expect(result).toContain('edited');
  });
});
