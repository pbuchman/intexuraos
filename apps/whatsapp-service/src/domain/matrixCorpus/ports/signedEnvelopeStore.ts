import type {
  MatrixCorpusSignedIngestV1,
  MatrixCorpusSignedTerminalControlV1,
} from '@intexuraos/http-contracts';

export type SignedEnvelopeAuthority = Readonly<{
  runtimeAudience: 'home-dev';
  runId: string;
  userId: string;
  leaseFence: string;
  leaseSlotDigest: string;
  runFenceDigest: string;
  ownerDigest: string;
  payloadDigest: string;
  expectedClaimExpiresAt: string;
}>;

export type SignedIngestEnvelopeStoreInput = SignedEnvelopeAuthority &
  Readonly<{ ingestOutboxId: string }>;
export type SignedTerminalEnvelopeStoreInput = SignedEnvelopeAuthority &
  Readonly<{ terminalControlId: string; eventId: string }>;

export interface MatrixCorpusSignedEnvelopeStore {
  prepareIngest(
    input: SignedIngestEnvelopeStoreInput &
      Readonly<{ proposedIssuedAt: string; proposedExpiresAt: string }>
  ): Promise<unknown>;
  completeIngest(
    input: SignedIngestEnvelopeStoreInput &
      Readonly<{
        generation: number;
        issuedAt: string;
        expiresAt: string;
        envelope: MatrixCorpusSignedIngestV1;
      }>
  ): Promise<unknown>;
  prepareTerminal(
    input: SignedTerminalEnvelopeStoreInput &
      Readonly<{ proposedIssuedAt: string; proposedExpiresAt: string }>
  ): Promise<unknown>;
  completeTerminal(
    input: SignedTerminalEnvelopeStoreInput &
      Readonly<{
        generation: number;
        issuedAt: string;
        expiresAt: string;
        envelope: MatrixCorpusSignedTerminalControlV1;
      }>
  ): Promise<unknown>;
}
