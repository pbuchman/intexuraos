export interface ReleaseAttestationInput {
  mergeSha: string;
  mergeTree: string;
  prHeadSha: string;
  prHeadTree: string;
  prHeadCommitMessage: string;
  stagedTree: string;
}

export interface CutoverWindow {
  cutoverStart: string;
  cutoverDeadline: string;
  nextLegacyBoundary: string;
}

export interface CutoverEstimate {
  replayDates: number;
  terraformChanges: number;
  rollbackMarginSeconds: number;
  totalSeconds: number;
}

export function parseTestedTreeTrailer(message: string): string;
export function verifyReleaseAttestation(input: ReleaseAttestationInput): {
  mergeSha: string;
  prHeadSha: string;
  testedTree: string;
};
export function deriveMessageDigestMigrationId(mergeSha: string): string;
export function computeCutoverWindow(start: string): CutoverWindow;
export function estimateCutoverDurationSeconds(input: {
  replayDates: number;
  terraformChanges: number;
}): CutoverEstimate;
export function assertCutoverEstimateFits(
  window: CutoverWindow,
  estimate: CutoverEstimate
): CutoverEstimate & { availableSeconds: number };
export function assertMigration128CutoverReadiness(statusOutput: string): {
  migrationId: '128';
  mode: 'pending' | 'already_applied';
};
export function validateTerraformPlan(
  root:
    | 'dev'
    | 'prod'
    | 'dev-inverse'
    | 'prod-inverse'
    | 'dev-inverse-complete'
    | 'prod-inverse-complete',
  plan: { resource_changes: Array<Record<string, unknown>> }
): Array<{ address: string; action: string }>;
