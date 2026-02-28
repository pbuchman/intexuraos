import type { DecisionKind } from '../models.js';

export function extractMergeableState(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const pr = (payload as Record<string, unknown>)['pull_request'];
  if (typeof pr !== 'object' || pr === null) return null;
  const state = (pr as Record<string, unknown>)['mergeable_state'];
  if (typeof state !== 'string') return null;
  return state;
}

export interface ConflictEligibilityInput {
  eventType: string;
  action: string | null;
  mergeableState: string | null;
  pullRequestNumber: number;
  repository: string;
  senderLogin: string;
}

export interface ConflictEligibilityDeps {
  isConflictDuplicate: (repository: string, prNumber: number) => boolean;
  isProtectedBranch: (repository: string) => boolean;
}

export interface ConflictEligibilityResult {
  eligible: boolean;
  decisionKind: DecisionKind;
  reasonCode: string;
  reasoning: string;
  deferred: boolean;
  intent?: 'conflict_resolution';
}

const CONFLICT_STATES = new Set(['dirty']);

const NON_CONFLICT_STATES = new Set(['clean', 'unstable', 'behind', 'blocked', 'draft', 'has_hooks']);

function ineligible(reasonCode: string, reasoning: string): ConflictEligibilityResult {
  return { eligible: false, decisionKind: 'noop', reasonCode, reasoning, deferred: false };
}

function deferred(reasonCode: string, reasoning: string): ConflictEligibilityResult {
  return { eligible: false, decisionKind: 'noop', reasonCode, reasoning, deferred: true };
}

export function evaluateConflictResolutionEligibility(
  input: ConflictEligibilityInput,
  deps: ConflictEligibilityDeps
): ConflictEligibilityResult {
  if (input.eventType !== 'pull_request') {
    return ineligible(
      'unsupported_event_type',
      `Event type '${input.eventType}' is not eligible for conflict resolution`
    );
  }

  if (input.pullRequestNumber === 0) {
    return ineligible(
      'no_pr_linkage',
      'Event has no linked PR — cannot determine target branch'
    );
  }

  if (input.mergeableState === null || input.mergeableState === 'unknown') {
    return deferred(
      'mergeability_unknown',
      'Mergeability not yet computed — deferring conflict check'
    );
  }

  if (NON_CONFLICT_STATES.has(input.mergeableState)) {
    return ineligible(
      'no_conflict',
      `PR mergeable state '${input.mergeableState}' indicates no conflict`
    );
  }

  if (!CONFLICT_STATES.has(input.mergeableState)) {
    return ineligible(
      'no_conflict',
      `PR mergeable state '${input.mergeableState}' is not a recognized conflict state`
    );
  }

  if (deps.isProtectedBranch(input.repository)) {
    return ineligible(
      'protected_branch_denied',
      'Conflict resolution denied — repository branch is protected'
    );
  }

  if (deps.isConflictDuplicate(input.repository, input.pullRequestNumber)) {
    return ineligible(
      'duplicate_conflict_action',
      'Conflict resolution already in progress for this PR'
    );
  }

  return {
    eligible: true,
    decisionKind: 'create_code_action',
    reasonCode: 'conflict_detected',
    reasoning: `PR #${String(input.pullRequestNumber)} has merge conflicts — eligible for conflict resolution`,
    deferred: false,
    intent: 'conflict_resolution',
  };
}
