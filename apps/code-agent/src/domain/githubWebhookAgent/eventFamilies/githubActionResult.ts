import type { DecisionKind } from '../models.js';

export interface RepairEligibilityInput {
  eventType: string;
  action: string | null;
  state: string | null;
  pullRequestNumber: number;
  repository: string;
  senderLogin: string;
}

export interface RepairEligibilityDeps {
  isRepairDuplicate: (repository: string, prNumber: number) => boolean;
  isProtectedBranch: (repository: string) => boolean;
}

export interface RepairEligibilityResult {
  eligible: boolean;
  decisionKind: DecisionKind;
  reasonCode: string;
  reasoning: string;
}

const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out']);

function hasFailureConclusion(state: string): boolean {
  const parts = state.split('/');
  const conclusion = parts[1];
  if (conclusion === undefined) {
    return false;
  }
  return FAILURE_CONCLUSIONS.has(conclusion);
}

function ineligible(reasonCode: string, reasoning: string): RepairEligibilityResult {
  return { eligible: false, decisionKind: 'noop', reasonCode, reasoning };
}

export function evaluateWorkflowRepairEligibility(
  input: RepairEligibilityInput,
  deps: RepairEligibilityDeps
): RepairEligibilityResult {
  if (input.eventType !== 'workflow_run') {
    return ineligible(
      'unsupported_ci_event',
      `Event type '${input.eventType}' is not eligible for repair`
    );
  }

  if (input.action !== 'completed') {
    return ineligible(
      'not_completed',
      `Action '${String(input.action)}' is not a completed workflow`
    );
  }

  if (input.state === null || !hasFailureConclusion(input.state)) {
    return ineligible(
      'not_failed',
      'Workflow did not fail — no repair needed'
    );
  }

  if (input.pullRequestNumber === 0) {
    return ineligible(
      'no_pr_linkage',
      'Workflow failure has no linked PR — cannot determine target branch'
    );
  }

  if (deps.isProtectedBranch(input.repository)) {
    return ineligible(
      'protected_branch_denied',
      'Repair denied — repository branch is protected'
    );
  }

  if (deps.isRepairDuplicate(input.repository, input.pullRequestNumber)) {
    return ineligible(
      'duplicate_repair',
      'Repair already in progress for this PR'
    );
  }

  return {
    eligible: true,
    decisionKind: 'create_code_action',
    reasonCode: 'workflow_failure_eligible',
    reasoning: `Workflow failed on PR #${String(input.pullRequestNumber)} — eligible for repair`,
  };
}
