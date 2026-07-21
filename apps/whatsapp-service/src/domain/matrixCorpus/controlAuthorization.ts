import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusControlRequestDigestInputV1,
  matrixCorpusControlMutationOperationV1Schema,
  matrixCorpusControlRequestDigestInputV1Schema,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusKeyedDigestSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSignedControlMutationV1Schema,
  type MatrixCorpusSignedControlMutationV1,
} from '@intexuraos/http-contracts';
import { z } from 'zod';

import { digestMatrixCorpusAttestationPayload } from './attestation.js';
import { transportStatusResultSchema } from './types.js';
import type { MatrixCorpusBoundLeaseAuthority } from './ports/matrixCorpusRouteControlPlane.js';

const AUTHORIZATION_TTL_MS = 30_000;

const inputSchema = z
  .object({
    runtimeAudience: z.literal('home-dev'),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
    operation: matrixCorpusControlMutationOperationV1Schema,
    request: z.record(z.string(), z.unknown()),
  })
  .strict();

type ControlAuthorizationInput = z.infer<typeof inputSchema>;

type ControlAuthorizationResult =
  | Readonly<{ code: 'AUTHORIZED'; authorization: MatrixCorpusSignedControlMutationV1 }>
  | Readonly<{ code: 'NOT_READY' }>
  | Readonly<{ code: 'CORRUPT_STATE' }>;

interface ControlAuthorizationIssuerDependencies {
  getTransportStatus(input: MatrixCorpusBoundLeaseAuthority): Promise<unknown>;
  sign(input: Readonly<{
    kind: 'matrix_corpus_control_mutation';
    eventId: string;
    leaseFence: string;
    payloadDigest: string;
    issuedAt: string;
    expiresAt: string;
    payload: Readonly<{
      version: 1;
      kind: z.infer<typeof matrixCorpusControlMutationOperationV1Schema>;
      eventId: string;
      runId: string;
      userId: string;
      leaseFence: string;
      requestDigest: string;
      createdAt: string;
    }>;
  }>): Promise<Readonly<{ ok: true; attestation: string }> | Readonly<{ ok: false; code: string }>>;
  now(): string;
  eventId(): string;
}

export function createMatrixCorpusControlAuthorizationIssuer(
  deps: ControlAuthorizationIssuerDependencies
): (input: ControlAuthorizationInput) => Promise<ControlAuthorizationResult> {
  return async (input) => {
    const parsedInput = inputSchema.safeParse(input);
    if (!parsedInput.success) return { code: 'CORRUPT_STATE' };
    const digestInput = matrixCorpusControlRequestDigestInputV1Schema.safeParse({
      version: 1,
      operation: parsedInput.data.operation,
      runId: parsedInput.data.runId,
      request: parsedInput.data.request,
    });
    if (!digestInput.success) return { code: 'CORRUPT_STATE' };

    let status: unknown;
    try {
      status = await deps.getTransportStatus(boundAuthority(parsedInput.data));
    } catch {
      return { code: 'NOT_READY' };
    }
    const parsedStatus = transportStatusResultSchema.safeParse(status);
    if (
      !parsedStatus.success ||
      parsedStatus.data.code !== 'TRANSPORT_STATUS' ||
      parsedStatus.data.runId !== parsedInput.data.runId ||
      parsedStatus.data.leaseFence !== parsedInput.data.leaseFence ||
      !phaseAllows(
        parsedInput.data.operation,
        parsedStatus.data.phase,
        parsedStatus.data.drained
      )
    )
      return { code: 'NOT_READY' };

    const issuedAt = deps.now();
    const issuedTime = Date.parse(issuedAt);
    const eventId = deps.eventId();
    if (!Number.isFinite(issuedTime) || !matrixCorpusSafeIdSchema.safeParse(eventId).success)
      return { code: 'CORRUPT_STATE' };
    const expiresAt = new Date(issuedTime + AUTHORIZATION_TTL_MS).toISOString();
    const requestDigest = createHash('sha256')
      .update(canonicalMatrixCorpusControlRequestDigestInputV1(digestInput.data), 'utf8')
      .digest('hex');
    const payload = {
      version: 1 as const,
      kind: parsedInput.data.operation,
      eventId,
      runId: parsedInput.data.runId,
      userId: parsedInput.data.userId,
      leaseFence: parsedInput.data.leaseFence,
      requestDigest,
      createdAt: issuedAt,
    };
    const payloadDigest = digestMatrixCorpusAttestationPayload(payload);
    const signed = await deps.sign({
      kind: 'matrix_corpus_control_mutation',
      eventId,
      leaseFence: parsedInput.data.leaseFence,
      payloadDigest,
      issuedAt,
      expiresAt,
      payload,
    });
    if (!signed.ok) return { code: 'CORRUPT_STATE' };
    const authorization = matrixCorpusSignedControlMutationV1Schema.safeParse({
      version: 1,
      kind: 'matrix_corpus_control_mutation',
      eventId,
      leaseFence: parsedInput.data.leaseFence,
      payloadDigest,
      attestation: signed.attestation,
    });
    return authorization.success
      ? { code: 'AUTHORIZED', authorization: authorization.data }
      : { code: 'CORRUPT_STATE' };
  };
}

function boundAuthority(input: ControlAuthorizationInput): MatrixCorpusBoundLeaseAuthority {
  return {
    runtimeAudience: input.runtimeAudience,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
    matrixRoomBindingDigest: input.matrixRoomBindingDigest,
    whatsappAccountBindingDigest: input.whatsappAccountBindingDigest,
    whatsappSenderBindingDigest: input.whatsappSenderBindingDigest,
  };
}

function phaseAllows(
  operation: ControlAuthorizationInput['operation'],
  phase:
    | 'provisioning'
    | 'active'
    | 'quiescing'
    | 'release_pending'
    | 'abandon_pending'
    | 'released'
    | 'abandoned',
  drained: boolean
): boolean {
  if (operation === 'register_context' || operation === 'create_projection')
    return phase === 'provisioning';
  if (operation === 'advance_projection')
    return phase === 'provisioning' || phase === 'active';
  return phase === 'quiescing' && drained;
}
