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

  it('includes review triage instructions and examples for @review comments', () => {
    const result = buildIssueCommentTriageSection({
      commentBody: '@review architecture, security with qwen',
      isEdit: false,
      isBotSender: false,
      senderLogin: 'user',
    });

    expect(result).toContain('Review Command Instructions');
    expect(result).toContain('Allowed worker types');
    expect(result).toContain('@review architecture, security with qwen');
    expect(result).toContain('qwen');
    expect(result).toContain('@review with minimax');
  });

  it('shows bot sender and edited action in the @review branch', () => {
    const result = buildIssueCommentTriageSection({
      commentBody: '@review architecture',
      isEdit: true,
      isBotSender: true,
      senderLogin: 'claude[bot]',
    });

    expect(result).toContain('Comment by: @claude[bot] (bot)');
    expect(result).toContain('Action: edited');
  });
});
