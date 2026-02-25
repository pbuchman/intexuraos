/**
 * Adaptive retry analyzer for task completion.
 *
 * Evaluates progress signals across verification attempts to decide whether
 * granting additional attempts would be productive.
 *
 * The core idea: a task that created a PR, pushed commits, and nearly passed CI
 * deserves more chances than one that produced nothing across multiple attempts.
 *
 * This module is purely analytical — it returns a decision but never modifies
 * task state or triggers retries. The TaskDispatcher acts on the decision.
 */

import type { TaskVerificationRecord, TaskResult } from '../types/task.js';

export interface RetryDecisionInput {
  /** Current attempt number (1-based). */
  currentAttempt: number;
  /** Configured max attempts (the base limit). */
  baseMaxAttempts: number;
  /** Verification history from all completed attempts. */
  verificationHistory: TaskVerificationRecord[];
  /** Task result extracted from the worktree after the latest attempt. */
  currentResult?: TaskResult;
  /** Task result from the previous attempt (if available). */
  previousResult?: TaskResult;
}

export type RetryDecisionOutcome = 'continue' | 'stop';

export interface RetryDecision {
  outcome: RetryDecisionOutcome;
  /** Effective max attempts (may exceed baseMaxAttempts if extended). */
  effectiveMaxAttempts: number;
  /** Human-readable explanation for logging. */
  reason: string;
  /** Numeric progress score for diagnostics. */
  progressScore: number;
  /** Per-signal score breakdown for diagnostics. */
  signalBreakdown: {
    resultProgress: number;
    verificationTrend: number;
  };
}

/**
 * Maximum number of bonus attempts the analyzer can grant beyond the base limit.
 * Prevents runaway retries even with positive progress signals.
 */
const MAX_BONUS_ATTEMPTS = 2;

/**
 * Minimum progress score required to grant bonus attempts.
 */
const BONUS_THRESHOLD = 2;

/**
 * Progress score at or below which we recommend early stopping,
 * even before reaching baseMaxAttempts.
 */
const EARLY_STOP_THRESHOLD = -2;

/**
 * Analyze progress signals across attempts to decide whether additional
 * retry attempts would be productive.
 *
 * Returns a decision with:
 * - `continue`: the task should be retried (effectiveMaxAttempts may be extended)
 * - `stop`: the task should be marked as failed
 */
export function analyzeRetryDecision(input: RetryDecisionInput): RetryDecision {
  const { currentAttempt, baseMaxAttempts, verificationHistory, currentResult, previousResult } =
    input;

  const { total: progressScore, resultProgress, verificationTrend } = calculateProgressScore(
    verificationHistory,
    currentResult,
    previousResult
  );

  if (progressScore <= EARLY_STOP_THRESHOLD) {
    return {
      outcome: 'stop',
      effectiveMaxAttempts: currentAttempt,
      reason: `Early stop: negative progress trend (score=${String(progressScore)})`,
      progressScore,
      signalBreakdown: { resultProgress, verificationTrend },
    };
  }

  const withinBaseLimit = currentAttempt < baseMaxAttempts;

  if (withinBaseLimit) {
    return {
      outcome: 'continue',
      effectiveMaxAttempts: baseMaxAttempts,
      reason: `Within base limit: attempt ${String(currentAttempt)}/${String(baseMaxAttempts)} (score=${String(progressScore)})`,
      progressScore,
      signalBreakdown: { resultProgress, verificationTrend },
    };
  }

  if (progressScore >= BONUS_THRESHOLD) {
    const bonusAttempts = Math.min(
      Math.floor(progressScore / BONUS_THRESHOLD),
      MAX_BONUS_ATTEMPTS
    );
    const effectiveMax = baseMaxAttempts + bonusAttempts;

    if (currentAttempt < effectiveMax) {
      return {
        outcome: 'continue',
        effectiveMaxAttempts: effectiveMax,
        reason: `Bonus granted: progress score ${String(progressScore)} earned ${String(bonusAttempts)} extra attempt(s)`,
        progressScore,
        signalBreakdown: { resultProgress, verificationTrend },
      };
    }
  }

  return {
    outcome: 'stop',
    effectiveMaxAttempts: baseMaxAttempts,
    reason: `Max attempts reached: ${String(currentAttempt)}/${String(baseMaxAttempts)} (score=${String(progressScore)})`,
    progressScore,
    signalBreakdown: { resultProgress, verificationTrend },
  };
}

/**
 * Calculate a progress score based on signals from verification history
 * and task results.
 *
 * Positive signals (task is making progress):
 * - PR created between attempts: +3
 * - New commits pushed: +2
 * - CI improved (failed → passed): +3
 * - Confidence increased between consecutive attempts: +1
 * - Missing criteria count decreased: +1
 *
 * Negative signals (task is stagnant or regressing):
 * - Same missing criteria across 2+ consecutive attempts: -2
 * - Confidence decreased: -1
 * - No task result at all (no PR, no branch, no commits): -1
 */
function calculateProgressScore(
  history: TaskVerificationRecord[],
  currentResult?: TaskResult,
  previousResult?: TaskResult
): { total: number; resultProgress: number; verificationTrend: number } {
  const resultProgress = scoreResultProgress(currentResult, previousResult);
  const verificationTrend = scoreVerificationTrend(history);
  return { total: resultProgress + verificationTrend, resultProgress, verificationTrend };
}

function scoreResultProgress(
  currentResult?: TaskResult,
  previousResult?: TaskResult
): number {
  if (currentResult === undefined) {
    return -1;
  }

  if (previousResult === undefined) {
    return 0;
  }

  let score = 0;

  const hadPR = previousResult.prUrl !== undefined && previousResult.prUrl !== '';
  const hasPR = currentResult.prUrl !== undefined && currentResult.prUrl !== '';

  if (hasPR && !hadPR) {
    score += 3;
  }

  const prevCommits = previousResult.commits ?? 0;
  const currCommits = currentResult.commits ?? 0;
  if (currCommits > prevCommits) {
    score += 2;
  }

  if (previousResult.ciFailed === true && currentResult.ciFailed === false) {
    score += 3;
  } else if (previousResult.ciFailed === false && currentResult.ciFailed === true) {
    score -= 2;
  }

  return score;
}

function scoreVerificationTrend(history: TaskVerificationRecord[]): number {
  const latest = history.length >= 2 ? history[history.length - 1] : undefined;
  const previous = history.length >= 2 ? history[history.length - 2] : undefined;

  if (latest === undefined || previous === undefined) {
    return 0;
  }

  let score = 0;

  if (latest.confidence > previous.confidence) {
    score += 1;
  } else if (latest.confidence < previous.confidence) {
    score -= 1;
  }

  if (latest.missingCriteria.length < previous.missingCriteria.length) {
    score += 1;
  }

  const latestCriteria = [...latest.missingCriteria].sort().join('|');
  const previousCriteria = [...previous.missingCriteria].sort().join('|');
  if (latestCriteria === previousCriteria && latestCriteria !== '') {
    score -= 2;
  }

  return score;
}
