/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred literal result types. */
import { createHash } from 'node:crypto';

import { canonicalMatrixCorpusControlRequestDigestInputV1 } from '@intexuraos/http-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createMatrixCorpusControlAuthorizationIssuer } from '../../../domain/matrixCorpus/controlAuthorization.js';

const now = '2026-07-20T10:00:00.000Z';

function input(
  operation:
    | 'register_context'
    | 'create_projection'
    | 'finalize_run'
    | 'advance_projection' = 'register_context'
) {
  return {
    runtimeAudience: 'home-dev' as const,
    runId: 'run_1',
    userId: 'configured_user',
    leaseFence: '7',
    matrixRoomBindingDigest: 'a'.repeat(64),
    whatsappAccountBindingDigest: 'b'.repeat(64),
    whatsappSenderBindingDigest: 'c'.repeat(64),
    operation,
    request: { kind: operation, exact: true },
  };
}

function transportStatus(
  phase: 'provisioning' | 'active' | 'quiescing',
  drained: boolean,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    code: 'TRANSPORT_STATUS' as const,
    runId: 'run_1',
    leaseFence: '7',
    phase,
    consumedCapabilityCount: 0,
    terminalIntexMarkerCount: 0,
    terminalOutboxCount: 0,
    replyOrDeliveryWorkInFlight: 0,
    nonterminalIngestOutboxCount: 0,
    drained,
    ...overrides,
  };
}

function fixture(phase: 'provisioning' | 'active' | 'quiescing', drained: boolean) {
  const getTransportStatus = vi.fn().mockResolvedValue(transportStatus(phase, drained));
  const sign = vi.fn().mockResolvedValue({ ok: true, attestation: 'e30.e30.AA' });
  return {
    getTransportStatus,
    sign,
    issuer: createMatrixCorpusControlAuthorizationIssuer({
      getTransportStatus,
      sign,
      now: () => now,
      eventId: () => 'control_event_1',
    }),
  };
}

describe('Matrix corpus control authorization issuer', () => {
  it('signs one exact provisioning mutation bound to the current lease', async () => {
    const { issuer, sign } = fixture('provisioning', false);

    await expect(issuer(input())).resolves.toMatchObject({
      code: 'AUTHORIZED',
      authorization: {
        kind: 'matrix_corpus_control_mutation',
        eventId: 'control_event_1',
        leaseFence: '7',
        attestation: 'e30.e30.AA',
      },
    });
    const requestDigest = createHash('sha256')
      .update(
        canonicalMatrixCorpusControlRequestDigestInputV1({
          version: 1,
          operation: 'register_context',
          runId: 'run_1',
          request: input().request,
        }),
        'utf8'
      )
      .digest('hex');
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'matrix_corpus_control_mutation',
        eventId: 'control_event_1',
        leaseFence: '7',
        issuedAt: now,
        expiresAt: '2026-07-20T10:00:30.000Z',
        payload: expect.objectContaining({
          kind: 'register_context',
          requestDigest,
        }),
      })
    );
  });

  it('allows finalization only for a fully drained quiescing transport', async () => {
    const active = fixture('active', true);
    const notDrained = fixture('quiescing', false);
    const ready = fixture('quiescing', true);

    await expect(active.issuer(input('finalize_run'))).resolves.toEqual({ code: 'NOT_READY' });
    await expect(notDrained.issuer(input('finalize_run'))).resolves.toEqual({ code: 'NOT_READY' });
    await expect(ready.issuer(input('finalize_run'))).resolves.toMatchObject({
      code: 'AUTHORIZED',
    });
    expect(active.sign).not.toHaveBeenCalled();
    expect(notDrained.sign).not.toHaveBeenCalled();
    expect(ready.sign).toHaveBeenCalledOnce();
  });

  it('allows the retention projection advance while the transport is still provisioning', async () => {
    const provisioning = fixture('provisioning', false);
    const active = fixture('active', false);
    const projection = fixture('provisioning', false);

    await expect(provisioning.issuer(input('advance_projection'))).resolves.toMatchObject({
      code: 'AUTHORIZED',
    });
    await expect(active.issuer(input('advance_projection'))).resolves.toMatchObject({
      code: 'AUTHORIZED',
    });
    await expect(projection.issuer(input('create_projection'))).resolves.toMatchObject({
      code: 'AUTHORIZED',
    });
    expect(provisioning.sign).toHaveBeenCalledOnce();
    expect(active.sign).toHaveBeenCalledOnce();
    expect(projection.sign).toHaveBeenCalledOnce();
  });

  it('fails closed when the transport status cannot be trusted', async () => {
    const { issuer, getTransportStatus, sign } = fixture('active', false);
    getTransportStatus.mockResolvedValueOnce({ code: 'NOT_FOUND' });

    await expect(issuer(input('advance_projection'))).resolves.toEqual({ code: 'NOT_READY' });
    expect(sign).not.toHaveBeenCalled();
  });

  it('rejects invalid input, canonicalization failure, transport throws, and mismatched status', async () => {
    const { issuer, getTransportStatus, sign } = fixture('active', false);
    await expect(issuer({ ...input(), runtimeAudience: 'production' } as never)).resolves.toEqual({
      code: 'CORRUPT_STATE',
    });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    await expect(issuer({ ...input(), request: circular })).resolves.toEqual({
      code: 'CORRUPT_STATE',
    });

    getTransportStatus.mockRejectedValueOnce(new Error('transport unavailable'));
    await expect(issuer(input('advance_projection'))).resolves.toEqual({ code: 'NOT_READY' });
    for (const status of [
      null,
      { code: 'NOT_FOUND' },
      transportStatus('active', false, { runId: 'run_changed' }),
      transportStatus('active', false, { leaseFence: '8' }),
    ]) {
      getTransportStatus.mockResolvedValueOnce(status);
      await expect(issuer(input('advance_projection'))).resolves.toEqual({ code: 'NOT_READY' });
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('fails closed for invalid clocks, event ids, signer failures, and malformed signatures', async () => {
    const base = fixture('provisioning', false);
    const createIssuer = (overrides: {
      now?: () => string;
      eventId?: () => string;
    } = {}) =>
      createMatrixCorpusControlAuthorizationIssuer({
        getTransportStatus: base.getTransportStatus,
        sign: base.sign,
        now: overrides.now ?? (() => now),
        eventId: overrides.eventId ?? (() => 'control_event_1'),
      });

    await expect(createIssuer({ now: () => 'invalid' })(input())).resolves.toEqual({
      code: 'CORRUPT_STATE',
    });
    await expect(createIssuer({ eventId: () => '' })(input())).resolves.toEqual({
      code: 'CORRUPT_STATE',
    });
    base.sign.mockResolvedValueOnce({ ok: false, code: 'SIGNING_FAILED' });
    await expect(createIssuer()(input())).resolves.toEqual({ code: 'CORRUPT_STATE' });
    base.sign.mockResolvedValueOnce({ ok: true, attestation: 'invalid' });
    await expect(createIssuer()(input())).resolves.toEqual({ code: 'CORRUPT_STATE' });
  });
});
