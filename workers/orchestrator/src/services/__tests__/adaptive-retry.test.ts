import { describe, it, expect } from 'vitest';
import {
  analyzeRetryDecision,
  type RetryDecisionInput,
} from '../adaptive-retry.js';
import type { TaskVerificationRecord, TaskResult } from '../../types/task.js';

function makeRecord(overrides: Partial<TaskVerificationRecord> = {}): TaskVerificationRecord {
  return {
    attempt: 1,
    passed: false,
    confidence: 0.3,
    reasons: ['test reason'],
    missingCriteria: ['PR URL line', 'CI evidence line'],
    resumeInstruction: 'fix it',
    usedLlm: true,
    createdAt: '2026-02-25T10:00:00Z',
    ...overrides,
  };
}

function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    ...overrides,
  };
}

describe('analyzeRetryDecision', () => {
  describe('within base limit', () => {
    it('continues when attempt is below max', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 1,
        baseMaxAttempts: 3,
        verificationHistory: [makeRecord({ attempt: 1 })],
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('continue');
      expect(decision.effectiveMaxAttempts).toBe(3);
    });

    it('continues at attempt 2 of 3 with improving signals', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 2,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0.2, missingCriteria: ['PR URL line', 'CI evidence line'] }),
          makeRecord({ attempt: 2, confidence: 0.4, missingCriteria: ['CI evidence line'] }),
        ],
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('continue');
      expect(decision.effectiveMaxAttempts).toBe(3);
    });
  });

  describe('at base limit with no progress', () => {
    it('stops when at max attempts with low progress', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0 }),
          makeRecord({ attempt: 2, confidence: 0 }),
          makeRecord({ attempt: 3, confidence: 0 }),
        ],
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('stop');
    });

    it('stops when same missing criteria repeat', () => {
      const stagnantCriteria = ['PHASE2_FINAL block', 'PR URL line'];
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, missingCriteria: stagnantCriteria }),
          makeRecord({ attempt: 2, missingCriteria: stagnantCriteria }),
          makeRecord({ attempt: 3, missingCriteria: stagnantCriteria }),
        ],
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('stop');
      expect(decision.progressScore).toBeLessThan(0);
    });
  });

  describe('bonus attempts from progress', () => {
    it('grants bonus when PR was created between attempts', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0.2 }),
          makeRecord({ attempt: 2, confidence: 0.5, missingCriteria: ['CI evidence line'] }),
          makeRecord({ attempt: 3, confidence: 0.6, missingCriteria: [] }),
        ],
        previousResult: makeResult(),
        currentResult: makeResult({
          prUrl: 'https://github.com/org/repo/pull/901',
          commits: 5,
        }),
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('continue');
      expect(decision.effectiveMaxAttempts).toBeGreaterThan(3);
      expect(decision.progressScore).toBeGreaterThanOrEqual(2);
    });

    it('grants bonus when CI improved from failing to passing', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0.3 }),
          makeRecord({ attempt: 2, confidence: 0.5 }),
          makeRecord({ attempt: 3, confidence: 0.7, missingCriteria: ['Summary line'] }),
        ],
        previousResult: makeResult({ ciFailed: true }),
        currentResult: makeResult({
          prUrl: 'https://github.com/org/repo/pull/901',
          ciFailed: false,
        }),
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('continue');
      expect(decision.progressScore).toBeGreaterThanOrEqual(2);
    });

    it('grants bonus when commits increased with rising confidence', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0.2, missingCriteria: ['a', 'b', 'c'] }),
          makeRecord({ attempt: 2, confidence: 0.4, missingCriteria: ['a', 'b'] }),
          makeRecord({ attempt: 3, confidence: 0.6, missingCriteria: ['a'] }),
        ],
        previousResult: makeResult({ commits: 2 }),
        currentResult: makeResult({
          prUrl: 'https://github.com/org/repo/pull/1',
          commits: 5,
        }),
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('continue');
      expect(decision.progressScore).toBeGreaterThanOrEqual(2);
    });

    it('caps bonus at MAX_BONUS_ATTEMPTS even with very high progress', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0.1, missingCriteria: ['a', 'b', 'c', 'd'] }),
          makeRecord({ attempt: 2, confidence: 0.4, missingCriteria: ['a', 'b'] }),
          makeRecord({ attempt: 3, confidence: 0.8, missingCriteria: ['a'] }),
        ],
        previousResult: makeResult({ ciFailed: true }),
        currentResult: makeResult({
          prUrl: 'https://github.com/org/repo/pull/1',
          commits: 8,
          ciFailed: false,
        }),
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('continue');
      expect(decision.effectiveMaxAttempts).toBe(5);
      expect(decision.progressScore).toBeGreaterThan(4);
    });

    it('penalizes CI regression from passing to failing', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0.5 }),
          makeRecord({ attempt: 2, confidence: 0.6 }),
          makeRecord({ attempt: 3, confidence: 0.5, missingCriteria: ['CI evidence line'] }),
        ],
        previousResult: makeResult({ ciFailed: false, commits: 3 }),
        currentResult: makeResult({ ciFailed: true, commits: 3 }),
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.progressScore).toBeLessThan(0);
    });
  });

  describe('early stopping', () => {
    it('stops early when stagnant with no result', () => {
      const stagnantCriteria = ['PHASE2_FINAL block'];
      const input: RetryDecisionInput = {
        currentAttempt: 2,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0.1, missingCriteria: stagnantCriteria }),
          makeRecord({ attempt: 2, confidence: 0, missingCriteria: stagnantCriteria }),
        ],
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('stop');
      expect(decision.reason).toContain('Early stop');
    });

    it('does not early-stop on first attempt', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 1,
        baseMaxAttempts: 3,
        verificationHistory: [makeRecord({ attempt: 1, confidence: 0 })],
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('continue');
    });
  });

  describe('edge cases', () => {
    it('handles empty verification history', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 1,
        baseMaxAttempts: 3,
        verificationHistory: [],
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('continue');
    });

    it('handles single attempt at limit', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 1,
        baseMaxAttempts: 1,
        verificationHistory: [makeRecord({ attempt: 1 })],
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('stop');
    });

    it('handles undefined results gracefully', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1 }),
          makeRecord({ attempt: 2 }),
          makeRecord({ attempt: 3 }),
        ],
        /* currentResult and previousResult intentionally omitted */
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('stop');
    });

    it('stops when bonus earned but attempt already at effective max', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 5,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 3, confidence: 0.3, missingCriteria: ['a', 'b'] }),
          makeRecord({ attempt: 4, confidence: 0.5, missingCriteria: ['a', 'b'] }),
          makeRecord({ attempt: 5, confidence: 0.7, missingCriteria: ['a'] }),
        ],
        previousResult: makeResult({ commits: 1 }),
        currentResult: makeResult({
          prUrl: 'https://github.com/org/repo/pull/1',
          commits: 5,
        }),
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.outcome).toBe('stop');
      expect(decision.progressScore).toBeGreaterThanOrEqual(2);
    });

    it('treats empty string prUrl same as undefined', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 3,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 2, confidence: 0.3, missingCriteria: ['a', 'b'] }),
          makeRecord({ attempt: 3, confidence: 0.5, missingCriteria: ['a'] }),
        ],
        previousResult: makeResult({ prUrl: '' }),
        currentResult: makeResult({
          prUrl: 'https://github.com/org/repo/pull/1',
          commits: 3,
        }),
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.progressScore).toBeGreaterThanOrEqual(3);
    });

    it('includes progress score in decision', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 1,
        baseMaxAttempts: 3,
        verificationHistory: [makeRecord()],
      };

      const decision = analyzeRetryDecision(input);

      expect(typeof decision.progressScore).toBe('number');
    });

    it('includes signal breakdown in decision', () => {
      const input: RetryDecisionInput = {
        currentAttempt: 1,
        baseMaxAttempts: 3,
        verificationHistory: [
          makeRecord({ attempt: 1, confidence: 0.3, missingCriteria: ['PR URL line', 'CI evidence line'] }),
        ],
        currentResult: makeResult({ prUrl: 'https://github.com/org/repo/pull/1', commits: 3, ciFailed: false }),
        previousResult: makeResult({ commits: 1, ciFailed: true }),
      };

      const decision = analyzeRetryDecision(input);

      expect(decision.signalBreakdown).toBeDefined();
      expect(decision.signalBreakdown.resultProgress).toBeGreaterThan(0);
      expect(typeof decision.signalBreakdown.verificationTrend).toBe('number');
    });
  });
});
