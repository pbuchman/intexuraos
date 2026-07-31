import type { Result } from '@intexuraos/common-core';

export interface MessageDigestRunPreparationBinding {
  userId: string;
  definitionId: string;
}

export interface MessageDigestRunPreparationClaims extends MessageDigestRunPreparationBinding {
  definitionRevision: number;
  stateRevision: number;
  erasureEpoch: number;
  windowStart: string;
  windowEnd: string;
  nextRunAt: string;
  persistedReadinessObservationVersion: string;
  preparedReadinessObservationVersion: string;
}

export interface MessageDigestRunPreparationTokenError {
  code: 'INVALID_PREPARATION_TOKEN';
  message: string;
}

export interface MessageDigestRunPreparationTokens {
  issue(
    claims: MessageDigestRunPreparationClaims
  ): Result<string, MessageDigestRunPreparationTokenError>;
  read(input: {
    token: string;
    binding: MessageDigestRunPreparationBinding;
  }): Result<MessageDigestRunPreparationClaims, MessageDigestRunPreparationTokenError>;
}
