import type { IntexAgentToolName } from '../../sessions/types.js';

export interface MatrixCorpusTestConfirmationIdentity {
  confirmationId: string;
  runId: string;
  scenarioId: string;
  sessionId: string;
  userId: string;
  leaseFence: string;
}

export interface MatrixCorpusTestConfirmationOperation {
  toolName: IntexAgentToolName;
  toolArgs: Record<string, unknown>;
  selectionTurnIndex: number;
  selectionOrdinal: number;
}

export interface MatrixCorpusTestConfirmation extends MatrixCorpusTestConfirmationIdentity {
  version: 1;
  lane: 'matrix_corpus';
  runtimeAudience: 'hetzner-prod';
  state: 'pending' | 'resolved';
  toolName: IntexAgentToolName;
  toolArgs: Record<string, unknown>;
  selectionTurnIndex: number;
  selectionOrdinal: number;
  operations?: readonly MatrixCorpusTestConfirmationOperation[];
  createdAt: string;
  expiresAt: string;
  decision: 'confirm' | 'reject' | null;
  resolutionMessageId: string | null;
  resolvedAt: string | null;
}

export type MatrixCorpusTestConfirmationFailure = Readonly<{
  ok: false;
  code:
    | 'NOT_FOUND'
    | 'CORRELATED_REPLAY_CONFLICT'
    | 'INVALID_LANE'
    | 'CORRUPT_CONFIRMATION'
    | 'EXPIRED'
    | 'ALREADY_RESOLVED';
}>;

export type MatrixCorpusTestConfirmationCreateResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      confirmation: MatrixCorpusTestConfirmation;
    }>
  | MatrixCorpusTestConfirmationFailure;

export type MatrixCorpusTestConfirmationGetResult =
  | Readonly<{ ok: true; confirmation: MatrixCorpusTestConfirmation }>
  | MatrixCorpusTestConfirmationFailure;

export type MatrixCorpusTestConfirmationResolveResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      confirmation: MatrixCorpusTestConfirmation;
    }>
  | MatrixCorpusTestConfirmationFailure;

export interface TestConfirmationRepository {
  createOrGet(input: Readonly<{
    identity: MatrixCorpusTestConfirmationIdentity;
    toolName: IntexAgentToolName;
    toolArgs: Record<string, unknown>;
    selectionTurnIndex: number;
    selectionOrdinal: number;
    operations?: readonly MatrixCorpusTestConfirmationOperation[];
    createdAt: string;
    expiresAt: string;
  }>): Promise<MatrixCorpusTestConfirmationCreateResult>;

  getExact(
    input: MatrixCorpusTestConfirmationIdentity & Readonly<{ now: string }>
  ): Promise<MatrixCorpusTestConfirmationGetResult>;

  resolveExact(input: Readonly<{
    identity: MatrixCorpusTestConfirmationIdentity;
    decision: 'confirm' | 'reject';
    resolutionMessageId: string;
    now: string;
  }>): Promise<MatrixCorpusTestConfirmationResolveResult>;
}
