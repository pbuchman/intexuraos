/**
 * UnifiedEvaluator service (facade).
 *
 * Single entry point for webhook event evaluation:
 * 1. Hard rules (deterministic) → dispatch / skip / needs_triage
 * 2. LLM triage (if needs_triage) → dispatch / skip / request_review
 * 3. Audit trail via EventDecision
 *
 * Implementation is split across sibling modules under `./unifiedEvaluator/`:
 *  - criteria.ts  — deterministic pre-LLM evaluation (CI failure rule, hard rules,
 *                   remediation interception)
 *  - scoring.ts   — LLM triage flow with retry + fallback handling
 *  - reporting.ts — audit + automation-log utilities
 */

import type { Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { UnifiedEvaluator, UnifiedEvaluatorDeps } from './unifiedEvaluator/types.js';
import { handleCheckSuiteCIFailure, handleHardRules } from './unifiedEvaluator/criteria.js';
import { handleLlmTriage } from './unifiedEvaluator/scoring.js';

export type { UnifiedEvaluator, UnifiedEvaluatorDeps } from './unifiedEvaluator/types.js';

export function createUnifiedEvaluator(deps: UnifiedEvaluatorDeps): UnifiedEvaluator {
  return {
    async evaluate(event: GitHubPREvent, logger: Logger): Promise<void> {
      const startTime = Date.now();

      // Special handling for check_suite events: CIFailureRule must be evaluated directly
      // because the webhookRules chain returns ALL_RULES_PASSED as the reason, not individual
      // rule reasons. This means CHECK_SUITE_TASK_BRANCH would never match via the chain.
      if (event.eventType === 'check_suite' && deps.ciFailureDispatchService !== undefined) {
        const handled = await handleCheckSuiteCIFailure(
          deps, deps.ciFailureDispatchService, event, startTime, logger,
        );
        if (handled) return;
      }

      // Step 1: Hard rules
      const rulesResult = await handleHardRules(deps, event, startTime, logger);
      if (rulesResult === 'handled') return;

      // Step 2: needs_triage → LLM
      await handleLlmTriage(deps, event, startTime, logger);
    },
  };
}
