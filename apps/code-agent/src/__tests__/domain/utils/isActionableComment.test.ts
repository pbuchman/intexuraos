import { describe, it, expect } from 'vitest';
import { isActionableComment } from '../../../domain/utils/isActionableComment.js';

describe('isActionableComment', () => {
  describe('Claude mentions', () => {
    it('returns true when comment mentions @claude-bot', () => {
      const result = isActionableComment({
        body: 'Hey @claude-bot please fix this bug',
        senderLogin: 'user123',
        senderType: 'User',
      });
      expect(result).toBe(true);
    });

    it('returns true when comment mentions @claude', () => {
      const result = isActionableComment({
        body: '@claude can you update the tests?',
        senderLogin: 'reviewer',
        senderType: 'User',
      });
      expect(result).toBe(true);
    });

    it('returns true when comment mentions @intexura-claude', () => {
      const result = isActionableComment({
        body: 'Hey @intexura-claude this needs a refactor',
        senderLogin: 'user123',
        senderType: 'User',
      });
      expect(result).toBe(true);
    });

    it('is case-insensitive for mentions', () => {
      const result = isActionableComment({
        body: '@CLAUDE-BOT please help',
        senderLogin: 'user123',
        senderType: 'User',
      });
      expect(result).toBe(true);
    });
  });

  describe('Bot comments', () => {
    it('returns false for bot comments even with Claude mention', () => {
      const result = isActionableComment({
        body: '@claude-bot test this',
        senderLogin: 'github-actions[bot]',
        senderType: 'Bot',
      });
      expect(result).toBe(false);
    });
  });

  describe('PR author with request patterns', () => {
    it('returns true when PR author asks a question', () => {
      const result = isActionableComment({
        body: 'Can this be improved?',
        senderLogin: 'pr-author',
        senderType: 'User',
        prAuthorLogin: 'pr-author',
      });
      expect(result).toBe(true);
    });

    it('returns true when PR author says "please fix"', () => {
      const result = isActionableComment({
        body: 'Please fix the edge case handling',
        senderLogin: 'pr-author',
        senderType: 'User',
        prAuthorLogin: 'pr-author',
      });
      expect(result).toBe(true);
    });

    it('returns true when PR author says "can you update"', () => {
      const result = isActionableComment({
        body: 'Can you update the error messages?',
        senderLogin: 'pr-author',
        senderType: 'User',
        prAuthorLogin: 'pr-author',
      });
      expect(result).toBe(true);
    });

    it('returns false for non-author with request pattern but no Claude mention', () => {
      const result = isActionableComment({
        body: 'Please fix this bug',
        senderLogin: 'reviewer',
        senderType: 'User',
        prAuthorLogin: 'pr-author',
      });
      expect(result).toBe(false);
    });
  });

  describe('Non-actionable comments', () => {
    it('returns false for empty body', () => {
      const result = isActionableComment({
        body: '',
        senderLogin: 'user123',
        senderType: 'User',
      });
      expect(result).toBe(false);
    });

    it('returns false for whitespace-only body', () => {
      const result = isActionableComment({
        body: '   \n\t  ',
        senderLogin: 'user123',
        senderType: 'User',
      });
      expect(result).toBe(false);
    });

    it('returns false for random comment without Claude mention', () => {
      const result = isActionableComment({
        body: 'LGTM! Nice work on this PR.',
        senderLogin: 'reviewer',
        senderType: 'User',
      });
      expect(result).toBe(false);
    });

    it('returns false for comment that mentions "claude" but not as username', () => {
      const result = isActionableComment({
        body: 'This reminds me of something Claude Shannon wrote about',
        senderLogin: 'reviewer',
        senderType: 'User',
      });
      expect(result).toBe(false);
    });
  });
});
