export const MESSAGE_DIGEST_CUTOVER_STEPS: readonly string[];

export interface CutoverState {
  version: 1;
  migrationId: string;
  mergeSha: string;
  testedTree: string;
  deploymentId: string;
  releaseDir: string;
  previousReleaseDir: string;
  cutoverStart: string;
  cutoverDeadline: string;
  attempt: number;
  attemptHistory: Array<{
    attempt: number;
    migrationId: string;
    mergeSha: string;
    testedTree: string;
    deploymentId: string;
    releaseDir: string;
    previousReleaseDir: string;
    cutoverStart: string;
    cutoverDeadline: string;
    completedSteps: string[];
    compensatedAt: string;
  }>;
  status: 'in_progress' | 'compensating' | 'compensated' | 'admitting' | 'admitted' | 'complete';
  admitted: boolean;
  admittingAt: string | null;
  admittedAt: string | null;
  compensatedAt: string | null;
  completedSteps: string[];
  [key: string]: unknown;
}

export function acquireCutoverLease(input: {
  statePath: string;
  migrationId: string;
  mergeSha: string;
  testedTree: string;
  deploymentId: string;
  releaseDir: string;
  previousReleaseDir: string;
  cutoverStart: string;
  cutoverDeadline: string;
  now: string;
}): CutoverState;
export function completeCutoverCheckpoint(input: {
  statePath: string;
  migrationId: string;
  deploymentId: string;
  step: string;
  now: string;
}): CutoverState;
export function beginPublicAdmission(input: {
  statePath: string;
  migrationId: string;
  deploymentId: string;
  now: string;
}): CutoverState;
export function beginCutoverCompensation(input: {
  statePath: string;
  migrationId: string;
  deploymentId: string;
  now: string;
}): CutoverState;
export function markCutoverCompensated(input: {
  statePath: string;
  migrationId: string;
  deploymentId: string;
  now: string;
}): CutoverState;
export function assertPreAdmissionCompensationAllowed(statePath: string): CutoverState;
export function markCutoverComplete(input: {
  statePath: string;
  migrationId: string;
  deploymentId: string;
  now: string;
}): CutoverState;
export function readCutoverState(statePath: string): CutoverState;
