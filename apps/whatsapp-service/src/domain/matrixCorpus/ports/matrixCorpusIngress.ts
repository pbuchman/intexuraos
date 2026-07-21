import type { MatrixCorpusVisibleHeaderV1 } from '@intexuraos/http-contracts';
import { z } from 'zod';

export interface MatrixCorpusReservedIngressInput {
  readonly message: MatrixCorpusVisibleHeaderV1;
  readonly userId: string;
  readonly transportMessageId: string;
  readonly webhookEventId: string;
  readonly senderPhoneNumber: string;
  readonly recipientPhoneNumber: string;
  readonly whatsappAccountId: string | null;
  readonly timestamp: string;
}

export const matrixCorpusReservedIngressResultSchema = z.union([
  z.object({ code: z.literal('INGEST_ENQUEUED') }).strict(),
  z.object({ code: z.literal('ALREADY_APPLIED') }).strict(),
  z.object({ code: z.literal('NOT_READY') }).strict(),
  z.object({ code: z.literal('CAPABILITY_REPLAY') }).strict(),
  z.object({ code: z.literal('CAPABILITY_EXPIRED') }).strict(),
  z.object({ code: z.literal('CAPABILITY_REVOKED') }).strict(),
  z.object({ code: z.literal('CAPABILITY_MISMATCH') }).strict(),
  z.object({ code: z.literal('TRANSPORT_REPLAY') }).strict(),
  z.object({ code: z.literal('LEASE_EXPIRED') }).strict(),
  z.object({ code: z.literal('STALE_FENCE') }).strict(),
  z.object({ code: z.literal('PHASE_CONFLICT') }).strict(),
  z.object({ code: z.literal('NOT_FOUND') }).strict(),
]);
export type MatrixCorpusReservedIngressResult = z.infer<
  typeof matrixCorpusReservedIngressResultSchema
>;

export interface MatrixCorpusIngressPort {
  consumeReservedMessage(
    input: MatrixCorpusReservedIngressInput
  ): Promise<MatrixCorpusReservedIngressResult>;
}

export const notReadyMatrixCorpusIngress: MatrixCorpusIngressPort = {
  consumeReservedMessage(): Promise<MatrixCorpusReservedIngressResult> {
    return Promise.resolve({ code: 'NOT_READY' });
  },
};
