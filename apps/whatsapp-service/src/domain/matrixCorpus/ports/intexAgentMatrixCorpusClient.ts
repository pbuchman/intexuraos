import {
  matrixCorpusDecimalFenceSchema,
  matrixCorpusKeyedDigestSchema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSha256DigestSchema,
  matrixCorpusSignedTerminalControlV1Schema,
} from '@intexuraos/http-contracts';
import { z } from 'zod';

export const matrixCorpusCurrentAcceptanceResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('admission_ready'),
      current: z.enum([
        'absent',
        'terminal_artifact_ready',
        'terminal_artifact_failed',
        'terminal_artifact_unknown',
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('admission_blocked'),
      reason: z.enum(['preflight', 'running', 'finalizing', 'artifact_pending', 'artifact_staged']),
    })
    .strict(),
  z.object({ kind: z.literal('not_ready') }).strict(),
]);
export type MatrixCorpusCurrentAcceptanceResult = z.infer<
  typeof matrixCorpusCurrentAcceptanceResultSchema
>;

export const matrixCorpusControlStatusResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_ready') }).strict(),
  z
    .object({
      kind: z.literal('status'),
      runId: matrixCorpusSafeIdSchema,
      userId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      lifecycle: z.enum(['preflight', 'running', 'finalizing', 'completed', 'stopped']),
      revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      contextReady: z.boolean(),
      manifestReady: z.boolean(),
      preflightProjectionReady: z.boolean(),
      retentionReconciled: z.boolean(),
      contextFinalizationTombstoneDigest: matrixCorpusSha256DigestSchema.nullable(),
      terminalCandidateDigest: matrixCorpusSha256DigestSchema.nullable(),
      artifactStageDigest: matrixCorpusSha256DigestSchema.nullable(),
      terminalControlEventId: matrixCorpusSafeIdSchema.nullable().optional(),
    })
    .strict(),
]);
export type MatrixCorpusControlStatusResult = z.infer<typeof matrixCorpusControlStatusResultSchema>;

export const matrixCorpusTurnTerminalResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_ready') }).strict(),
  z
    .object({
      kind: z.literal('terminal'),
      runId: matrixCorpusSafeIdSchema,
      userId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      scenarioId: matrixCorpusSafeIdSchema,
      turnIndex: z.number().int().min(0).max(19),
      status: z.enum(['completed', 'failed']),
      terminalMarkerDigest: matrixCorpusSha256DigestSchema,
      recordedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
]);
export type MatrixCorpusTurnTerminalResult = z.infer<
  typeof matrixCorpusTurnTerminalResultSchema
>;

export const matrixCorpusTerminalAuthoritativeWinnerV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('release'),
      eventId: matrixCorpusSafeIdSchema,
      payloadDigest: matrixCorpusSha256DigestSchema,
      outcome: z.enum(['completed_passed', 'completed_failed', 'stopped_not_evaluated']),
      acknowledgedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('abandoned'),
      eventId: matrixCorpusSafeIdSchema,
      payloadDigest: matrixCorpusSha256DigestSchema,
      outcome: z.enum(['stopped_not_evaluated', 'provisioning_noop', 'provisioning_rolled_back']),
      acknowledgedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
]);
export type MatrixCorpusTerminalAuthoritativeWinnerV1 = z.infer<
  typeof matrixCorpusTerminalAuthoritativeWinnerV1Schema
>;

export const matrixCorpusPostTerminalControlResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('acknowledged'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      requestEventId: matrixCorpusSafeIdSchema,
      requestPayloadDigest: matrixCorpusSha256DigestSchema,
      winner: matrixCorpusTerminalAuthoritativeWinnerV1Schema,
    })
    .strict(),
  z.object({ kind: z.literal('not_ready') }).strict(),
]);
export type MatrixCorpusPostTerminalControlResult = z.infer<
  typeof matrixCorpusPostTerminalControlResultSchema
>;

export interface AcquisitionReadinessPort {
  getCurrentAcceptance(input: Readonly<{
    runtimeAudience: 'home-dev';
    userId: string;
  }>): Promise<MatrixCorpusCurrentAcceptanceResult>;
}

export interface MatrixCorpusControlStatusPort {
  getControlStatus(input: Readonly<{
    runtimeAudience: 'home-dev';
    runId: string;
    userId: string;
    leaseFence: string;
  }>): Promise<MatrixCorpusControlStatusResult>;
}

export interface IntexAgentMatrixCorpusClient
  extends AcquisitionReadinessPort,
    MatrixCorpusControlStatusPort {
  getTurnTerminal(input: Readonly<{
    runtimeAudience: 'home-dev';
    runId: string;
    userId: string;
    leaseFence: string;
    scenarioId: string;
    turnIndex: number;
  }>): Promise<MatrixCorpusTurnTerminalResult>;
  postTerminalControl(input: Readonly<{
    runId: string;
    envelope: z.infer<typeof matrixCorpusSignedTerminalControlV1Schema>;
  }>): Promise<MatrixCorpusPostTerminalControlResult>;
}

export const matrixCorpusClaimOwnerDigestSchema = matrixCorpusKeyedDigestSchema;
