import { describe, it, expect } from 'vitest';
import { parseWorkerTypeDirective } from '../../../domain/githubWebhookAgent/directiveParser.js';

describe('parseWorkerTypeDirective', () => {
  describe('slash command syntax', () => {
    it('parses /intex worker=sonnet', () => {
      const result = parseWorkerTypeDirective('/intex worker=sonnet');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('sonnet');
        expect(result.source).toBe('explicit_comment');
      }
    });

    it('parses /intex worker=opus', () => {
      const result = parseWorkerTypeDirective('/intex worker=opus');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('opus');
      }
    });

    it('parses /intex worker=auto', () => {
      const result = parseWorkerTypeDirective('/intex worker=auto');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('auto');
      }
    });

    it('parses /intex worker=minimax', () => {
      const result = parseWorkerTypeDirective('/intex worker=minimax');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('minimax');
      }
    });

    it('parses /intex worker=glm', () => {
      const result = parseWorkerTypeDirective('/intex worker=glm');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('glm');
      }
    });

    it('parses directive embedded in longer text', () => {
      const body = 'Please fix the bug.\n\n/intex worker=opus\n\nThanks!';
      const result = parseWorkerTypeDirective(body);
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('opus');
      }
    });
  });

  describe('HTML comment syntax', () => {
    it('parses <!-- intex:worker=opus -->', () => {
      const result = parseWorkerTypeDirective('<!-- intex:worker=opus -->');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('opus');
        expect(result.source).toBe('explicit_comment');
      }
    });

    it('parses <!-- intex:worker=sonnet -->', () => {
      const result = parseWorkerTypeDirective('<!-- intex:worker=sonnet -->');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('sonnet');
      }
    });

    it('parses HTML comment with extra whitespace', () => {
      const result = parseWorkerTypeDirective('<!--  intex:worker=glm  -->');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('glm');
      }
    });

    it('parses HTML comment embedded in PR description', () => {
      const body = '## Changes\n\nFixed auth.\n\n<!-- intex:worker=opus -->\n';
      const result = parseWorkerTypeDirective(body);
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('opus');
      }
    });
  });

  describe('case insensitivity', () => {
    it('accepts uppercase worker name', () => {
      const result = parseWorkerTypeDirective('/intex worker=OPUS');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('opus');
      }
    });

    it('accepts mixed case worker name', () => {
      const result = parseWorkerTypeDirective('/intex worker=Sonnet');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('sonnet');
      }
    });
  });

  describe('no directive found', () => {
    it('returns not found for empty body', () => {
      const result = parseWorkerTypeDirective('');
      expect(result.found).toBe(false);
    });

    it('returns not found for null body', () => {
      const result = parseWorkerTypeDirective(null);
      expect(result.found).toBe(false);
    });

    it('returns not found for undefined body', () => {
      const result = parseWorkerTypeDirective(undefined);
      expect(result.found).toBe(false);
    });

    it('returns not found for unrelated text', () => {
      const result = parseWorkerTypeDirective('Please fix the login bug');
      expect(result.found).toBe(false);
    });

    it('returns not found for invalid worker type', () => {
      const result = parseWorkerTypeDirective('/intex worker=gpt4');
      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe('invalid_worker_type');
      }
    });

    it('returns not found for malformed slash command', () => {
      const result = parseWorkerTypeDirective('/intex worker');
      expect(result.found).toBe(false);
    });
  });

  describe('conflicting directives', () => {
    it('rejects body with conflicting worker types', () => {
      const body = '/intex worker=sonnet\n\n<!-- intex:worker=glm -->';
      const result = parseWorkerTypeDirective(body);
      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe('conflicting_directives');
      }
    });

    it('accepts multiple identical directives', () => {
      const body = '/intex worker=opus\n\n<!-- intex:worker=opus -->';
      const result = parseWorkerTypeDirective(body);
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('opus');
      }
    });
  });

  describe('edge cases', () => {
    it('ignores directive inside code block', () => {
      const body = '```\n/intex worker=opus\n```';
      const result = parseWorkerTypeDirective(body);
      expect(result.found).toBe(false);
    });

    it('ignores directive inside inline code', () => {
      const body = 'Use `<!-- intex:worker=opus -->` to set worker';
      const result = parseWorkerTypeDirective(body);
      expect(result.found).toBe(false);
    });

    it('handles trailing punctuation after worker name', () => {
      const result = parseWorkerTypeDirective('/intex worker=opus.');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.workerType).toBe('opus');
      }
    });

    it('preserves original match fragment', () => {
      const result = parseWorkerTypeDirective('/intex worker=Opus');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.matches).toContain('/intex worker=Opus');
      }
    });

    it('is deterministic for repeated input', () => {
      const body = '/intex worker=sonnet\nsome text';
      const a = parseWorkerTypeDirective(body);
      const b = parseWorkerTypeDirective(body);
      expect(a).toEqual(b);
    });
  });
});
