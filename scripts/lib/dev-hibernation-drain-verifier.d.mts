import type { KeyObject } from 'node:crypto';

export interface DrainVerificationResult {
  pendingStatus: 'zero' | 'nonzero' | 'unknown';
  reasons: string[];
}

export interface DevDrainReplayClaim {
  evidenceRunId: string;
  operationNonce: string;
  artifactIdSha256: string;
  createdAt: string;
}

export interface DevDrainVerificationContext {
  expectedEvidenceRunId: string;
  expectedOperationNonce: string;
  currentTime: Date;
  maxAgeMs: number;
  consumeOperationNonce: (claim: Readonly<DevDrainReplayClaim>) => boolean;
}

export const MAX_DEV_DRAIN_ARTIFACT_AGE_MS: number;

/** Internal evaluator for already authenticated, collector-assembled evidence. */
export function evaluateUnsignedDevDrainEvidence(input: unknown): DrainVerificationResult;

export function verifyDevDrain(
  artifact: unknown,
  publicKeyInput: KeyObject,
  context: DevDrainVerificationContext
): DrainVerificationResult;
