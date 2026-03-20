/**
 * Plan document detection utilities.
 *
 * Deterministic file-pattern matching for plan-only PRs.
 * Used by the GitHub Agent to short-circuit LLM triage when
 * all PR files are plan documents.
 */

import type { RuleOutcome } from '../services/gitHubWebhookRules.js';

/**
 * Check if a filename matches the plan document pattern.
 * Matches .md files in a /plans/ directory OR with "plan" as a word boundary
 * in the filename (e.g., my-plan.md, plan-v2.md) but NOT substrings
 * like "explanation.md" or "airplane.md".
 */
export function isPlanFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.md')) return false;
  // Files inside a plans/ directory (e.g., docs/plans/2026-03-20-foo.md)
  if (lower.includes('/plans/')) return true;
  // Files with "plan" as a word boundary in the name (e.g., my-plan-v2.md)
  return /\bplan\b/.test(lower);
}

/**
 * Evaluate a set of PR files for plan document detection.
 *
 * - All files are plan docs → dispatch (plan_review)
 * - Mix of plan and code files → needs_triage (LLM handles code review)
 * - No plan files → needs_triage (standard triage)
 */
export function evaluatePlanFiles(files: { filename: string }[]): RuleOutcome {
  if (files.length === 0) {
    return { action: 'needs_triage', reason: 'NO_FILES_TO_EVALUATE' };
  }

  const allPlan = files.every((f) => isPlanFile(f.filename));

  if (allPlan) {
    return {
      action: 'dispatch',
      reason: 'PLAN_ONLY_PR',
      context: { reviewType: 'plan_review' },
    };
  }

  return { action: 'needs_triage', reason: 'NOT_PLAN_ONLY_PR' };
}
