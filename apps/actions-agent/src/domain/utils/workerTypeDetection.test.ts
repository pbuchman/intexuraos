import { describe, it, expect } from 'vitest';
import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core';
import { detectWorkerTypeFromMessage } from './workerTypeDetection.js';

describe('detectWorkerTypeFromMessage', () => {
  describe('keyword detection for each worker type', () => {
    it('returns opus for "use opus to refactor auth"', () => {
      expect(detectWorkerTypeFromMessage('use opus to refactor auth')).toBe('opus');
    });

    it('returns sonnet for "use sonnet for this task"', () => {
      expect(detectWorkerTypeFromMessage('use sonnet for this task')).toBe('sonnet');
    });

    it('returns minimax for "use minimax to review"', () => {
      expect(detectWorkerTypeFromMessage('use minimax to review')).toBe('minimax');
    });

    it('returns glm for "use glm for the fix"', () => {
      expect(detectWorkerTypeFromMessage('use glm for the fix')).toBe('glm');
    });

    it('returns qwen for "use qwen to analyze"', () => {
      expect(detectWorkerTypeFromMessage('use qwen to analyze')).toBe('qwen');
    });

    it('returns kimi for "use kimi to investigate"', () => {
      expect(detectWorkerTypeFromMessage('use kimi to investigate')).toBe('kimi');
    });
  });

  describe('no keyword match', () => {
    it('returns undefined when no keyword matches', () => {
      expect(detectWorkerTypeFromMessage('add a new endpoint for users')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(detectWorkerTypeFromMessage('')).toBeUndefined();
    });
  });

  describe('case insensitivity', () => {
    it('matches "Use Opus" (title case)', () => {
      expect(detectWorkerTypeFromMessage('Use Opus to refactor')).toBe('opus');
    });

    it('matches "USE KIMI" (all caps)', () => {
      expect(detectWorkerTypeFromMessage('USE KIMI to investigate')).toBe('kimi');
    });

    it('matches "uSe SoNnEt" (mixed case)', () => {
      expect(detectWorkerTypeFromMessage('uSe SoNnEt for this task')).toBe('sonnet');
    });
  });

  describe('ambiguity resolution', () => {
    it('returns undefined when multiple different types match', () => {
      expect(detectWorkerTypeFromMessage('use opus and use kimi')).toBeUndefined();
    });

    it('returns undefined when three types match', () => {
      expect(detectWorkerTypeFromMessage('use opus, use kimi, use glm')).toBeUndefined();
    });
  });

  describe('exhaustiveness', () => {
    it('has a detection rule for every non-auto type in CODE_TASK_WORKER_TYPES', () => {
      const nonAutoTypes = CODE_TASK_WORKER_TYPES.filter((t) => t !== 'auto');
      for (const workerType of nonAutoTypes) {
        const result = detectWorkerTypeFromMessage(`use ${workerType}`);
        expect(result).toBe(workerType);
      }
    });
  });
});
