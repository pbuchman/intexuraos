import { describe, expect, it } from 'vitest';
import {
  ensureDispatchLabelsForAgentType,
  hasPrCommentLabel,
  resolveTaskAgentType,
} from '../../../domain/utils/taskRouting.js';

describe('taskRouting', () => {
  describe('hasPrCommentLabel', () => {
    it('returns true for normalized pr-comment labels', () => {
      expect(hasPrCommentLabel(['PR Comment'])).toBe(true);
    });

    it('returns false when pr-comment is absent', () => {
      expect(hasPrCommentLabel(['bug'])).toBe(false);
    });
  });

  describe('resolveTaskAgentType', () => {
    it('returns the stored agent type when present', () => {
      expect(resolveTaskAgentType({ agentType: 'pull_request', systemPromptHash: 'other' }, ['bug'])).toBe(
        'pull_request'
      );
    });

    it('infers pull_request from the pr-comment system prompt hash', () => {
      expect(resolveTaskAgentType({ systemPromptHash: 'pr-comment-auto' }, ['bug'])).toBe(
        'pull_request'
      );
    });

    it('infers review from the review system prompt hash', () => {
      expect(resolveTaskAgentType({ systemPromptHash: 'review-auto' }, ['bug'])).toBe('review');
    });

    it('treats stored PR metadata as execution for legacy tasks', () => {
      expect(
        resolveTaskAgentType(
          {
            systemPromptHash: 'other',
            result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/1131' },
          },
          ['bug']
        )
      ).toBe('execution');
    });

    it('falls back to execution for code-task labels', () => {
      expect(resolveTaskAgentType({ systemPromptHash: 'other' }, ['code-task'])).toBe('execution');
    });

    it('falls back to planning when no routing signals are present', () => {
      expect(resolveTaskAgentType({ systemPromptHash: 'other' }, ['bug'])).toBe('planning');
    });
  });

  describe('ensureDispatchLabelsForAgentType', () => {
    it('appends pr-comment for pull_request tasks when missing', () => {
      expect(ensureDispatchLabelsForAgentType(['bug'], 'pull_request')).toEqual(['bug', 'pr-comment']);
    });

    it('does not duplicate an existing pr-comment label', () => {
      expect(ensureDispatchLabelsForAgentType(['bug', 'pr-comment'], 'pull_request')).toEqual([
        'bug',
        'pr-comment',
      ]);
    });

    it('leaves non pull_request labels unchanged', () => {
      expect(ensureDispatchLabelsForAgentType(['bug'], 'planning')).toEqual(['bug']);
    });
  });
});
