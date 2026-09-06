/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred literal result types. */
import { createHash } from 'node:crypto';
import {
  CompactSign,
  decodeProtectedHeader,
  generateKeyPair,
  type CompactJWSHeaderParameters,
  type KeyLike,
} from 'jose';
import { describe, expect, it } from 'vitest';

import {
  MATRIX_CORPUS_MAX_COMPACT_JWS_CODE_UNITS,
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusControlMutationV1,
  canonicalMatrixCorpusTerminalControlV1,
  type MatrixCorpusAttestationClaimsV1,
  type MatrixCorpusAttestedIngestPayloadV1,
  type MatrixCorpusSignedIngestV1,
  type MatrixCorpusSignedControlMutationV1,
  type MatrixCorpusSignedTerminalControlV1,
  type MatrixCorpusControlMutationV1,
  type MatrixCorpusTerminalControlV1,
} from '@intexuraos/http-contracts';

import {
  digestMatrixCorpusAttestationPayload,
  signMatrixCorpusAttestation,
  verifyMatrixCorpusAttestation,
} from '../../../domain/matrixCorpus/attestation.js';
import { verifyMatrixCorpusAttestation as verifyWithIntexAgent } from '../../../../../intex-agent/src/domain/matrixCorpus/attestation.js';

const issuedAt = '2026-07-20T00:00:00.000Z';
const expiresAt = '2026-07-20T00:05:00.000Z';
const keyVersion = 'key_v1';

function ingestPayload(): MatrixCorpusAttestedIngestPayloadV1 {
  return {
    version: 1,
    kind: 'matrix_corpus_ingest_payload',
    ordinaryIngest: {
      type: 'intex.message.ingest',
      userId: 'user_1',
      messageId: 'message_1',
      text: 'private fixture text',
      sourceType: 'whatsapp_text',
      timestamp: issuedAt,
    },
    context: {
      version: 1,
      kind: 'matrix_corpus',
      runtimeAudience: 'hetzner-prod',
      leaseFence: '7',
      ingestReceiptId: 'receipt_1',
      runId: 'run_1',
      scenarioId: 'scenario_1',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario one',
      turnIndex: 0,
      phase: 'start',
      startNewSession: true,
      promptNormalizationVersion: 1,
      promptDigest: '1'.repeat(64),
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile: {
        version: 1,
        calls: [],
        forbiddenSelections: [],
        unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
      },
      mockProfileDigest: '2'.repeat(64),
      expectedToolSchedule: [],
      currentDateTime: issuedAt,
      timeZone: 'Europe/Warsaw',
    },
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function signedIngest(
  privateKey: KeyLike,
  payload = ingestPayload()
): Promise<Readonly<{ envelope: MatrixCorpusSignedIngestV1; claims: MatrixCorpusAttestationClaimsV1 }>> {
  const payloadDigest = sha256(canonicalMatrixCorpusIngestPayloadV1(payload));
  const result = await signMatrixCorpusAttestation(
    {
      kind: 'matrix_corpus_ingest',
      eventId: payload.context.ingestReceiptId,
      leaseFence: payload.context.leaseFence,
      payloadDigest,
      issuedAt,
      expiresAt,
      payload,
    },
    { keyVersion, privateKey }
  );
  if (!result.ok) throw new Error(`fixture signing failed: ${result.code}`);
  const envelope = {
    version: 1,
    kind: 'matrix_corpus_ingest',
    ingestReceiptId: payload.context.ingestReceiptId,
    leaseFence: payload.context.leaseFence,
    payloadDigest,
    attestation: result.attestation,
  } satisfies MatrixCorpusSignedIngestV1;
  const claims = {
    version: 1,
    kind: 'matrix_corpus_ingest',
    issuer: 'whatsapp-service',
    audience: 'intex-agent',
    runtimeAudience: 'hetzner-prod',
    keyVersion,
    eventId: payload.context.ingestReceiptId,
    leaseFence: payload.context.leaseFence,
    payloadDigest,
    issuedAt,
    expiresAt,
    payload,
  } satisfies MatrixCorpusAttestationClaimsV1;
  return { envelope, claims };
}

async function rawAttestation(
  claims: unknown,
  privateKey: KeyLike,
  protectedHeader: CompactJWSHeaderParameters = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: keyVersion,
  }
): Promise<string> {
  return await new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader(protectedHeader)
    .sign(privateKey);
}

describe('Matrix corpus attestation', () => {
  it('signs and verifies one closed Ed25519 envelope with a stable canonical digest', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA');
    const payload = ingestPayload();
    const reorderedPayload = {
      context: payload.context,
      ordinaryIngest: payload.ordinaryIngest,
      kind: payload.kind,
      version: payload.version,
    };
    expect(digestMatrixCorpusAttestationPayload(payload)).toBe(
      digestMatrixCorpusAttestationPayload(reorderedPayload)
    );

    const { envelope, claims } = await signedIngest(privateKey, payload);
    expect(decodeProtectedHeader(envelope.attestation)).toEqual({
      alg: 'EdDSA',
      typ: 'JWT',
      kid: keyVersion,
    });
    await expect(
      verifyMatrixCorpusAttestation(envelope, {
        keyring: new Map([[keyVersion, publicKey]]),
        now: () => '2026-07-20T00:05:30.000Z',
      })
    ).resolves.toEqual({ ok: true, claims });
  });

  it('accepts only configured current or previous key versions', async () => {
    const current = await generateKeyPair('EdDSA');
    const previous = await generateKeyPair('EdDSA');
    const currentSigned = await signedIngest(current.privateKey);
    const previousPayload = ingestPayload();
    const previousDigest = digestMatrixCorpusAttestationPayload(previousPayload);
    const previousResult = await signMatrixCorpusAttestation(
      {
        kind: 'matrix_corpus_ingest',
        eventId: previousPayload.context.ingestReceiptId,
        leaseFence: previousPayload.context.leaseFence,
        payloadDigest: previousDigest,
        issuedAt,
        expiresAt,
        payload: previousPayload,
      },
      { keyVersion: 'key_v0', privateKey: previous.privateKey }
    );
    if (!previousResult.ok) throw new Error('previous-key fixture signing failed');
    const previousEnvelope = {
      ...currentSigned.envelope,
      attestation: previousResult.attestation,
    };
    const keyring = new Map([
      [keyVersion, current.publicKey],
      ['key_v0', previous.publicKey],
    ]);
    const verification = { keyring, now: () => '2026-07-20T00:05:30.000Z' } as const;

    await expect(verifyMatrixCorpusAttestation(currentSigned.envelope, verification)).resolves.toMatchObject({
      ok: true,
    });
    await expect(verifyMatrixCorpusAttestation(previousEnvelope, verification)).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      verifyMatrixCorpusAttestation(currentSigned.envelope, {
        keyring: new Map([['key_v0', previous.publicKey]]),
        now: verification.now,
      })
    ).resolves.toEqual({ ok: false, code: 'UNKNOWN_KEY_VERSION' });
  });

  it('rejects a correctly signed legacy Home Dev audience before accepting claims', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const current = await signedIngest(trusted.privateKey);
    const legacyClaims = { ...current.claims, runtimeAudience: 'home-dev' };
    const legacyEnvelope = {
      ...current.envelope,
      attestation: await rawAttestation(legacyClaims, trusted.privateKey),
    };

    await expect(
      verifyMatrixCorpusAttestation(legacyEnvelope, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
  });

  it('rejects Ed448 keys even though JOSE also labels them EdDSA', async () => {
    const ed448 = await generateKeyPair('EdDSA', { crv: 'Ed448' });
    const payload = ingestPayload();
    const payloadDigest = digestMatrixCorpusAttestationPayload(payload);
    await expect(
      signMatrixCorpusAttestation(
        {
          kind: 'matrix_corpus_ingest',
          eventId: payload.context.ingestReceiptId,
          leaseFence: payload.context.leaseFence,
          payloadDigest,
          issuedAt,
          expiresAt,
          payload,
        },
        { keyVersion, privateKey: ed448.privateKey }
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_KEY_CONFIGURATION' });

    const claims = {
      version: 1,
      kind: 'matrix_corpus_ingest',
      issuer: 'whatsapp-service',
      audience: 'intex-agent',
      runtimeAudience: 'hetzner-prod',
      keyVersion,
      eventId: payload.context.ingestReceiptId,
      leaseFence: payload.context.leaseFence,
      payloadDigest,
      issuedAt,
      expiresAt,
      payload,
    } satisfies MatrixCorpusAttestationClaimsV1;
    const envelope = {
      version: 1,
      kind: 'matrix_corpus_ingest',
      ingestReceiptId: payload.context.ingestReceiptId,
      leaseFence: payload.context.leaseFence,
      payloadDigest,
      attestation: await rawAttestation(claims, ed448.privateKey),
    } satisfies MatrixCorpusSignedIngestV1;

    await expect(
      verifyMatrixCorpusAttestation(envelope, {
        keyring: new Map([[keyVersion, ed448.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_KEY_CONFIGURATION' });
  });

  it('keeps the production WhatsApp signer byte-compatible with the production Intex verifier', async () => {
    const trusted = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const payload = ingestPayload();
    const signed = await signedIngest(trusted.privateKey, payload);

    await expect(
      verifyWithIntexAgent(signed.envelope, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toEqual({ ok: true, claims: signed.claims });
  });

  it('signs a closed current-fence control mutation accepted by the Intex verifier', async () => {
    const trusted = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const payload: MatrixCorpusControlMutationV1 = {
      version: 1,
      kind: 'register_context',
      eventId: 'control_event_1',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '7',
      requestDigest: 'c'.repeat(64),
      createdAt: issuedAt,
    };
    const payloadDigest = sha256(canonicalMatrixCorpusControlMutationV1(payload));
    const signed = await signMatrixCorpusAttestation(
      {
        kind: 'matrix_corpus_control_mutation',
        eventId: payload.eventId,
        leaseFence: payload.leaseFence,
        payloadDigest,
        issuedAt,
        expiresAt,
        payload,
      },
      { keyVersion, privateKey: trusted.privateKey }
    );
    if (!signed.ok) throw new Error(`control fixture signing failed: ${signed.code}`);
    const envelope: MatrixCorpusSignedControlMutationV1 = {
      version: 1,
      kind: 'matrix_corpus_control_mutation',
      eventId: payload.eventId,
      leaseFence: payload.leaseFence,
      payloadDigest,
      attestation: signed.attestation,
    };

    await expect(
      verifyWithIntexAgent(envelope, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      claims: { kind: 'matrix_corpus_control_mutation', payload },
    });
    await expect(
      verifyMatrixCorpusAttestation(envelope, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      claims: { kind: 'matrix_corpus_control_mutation', payload },
    });
  });

  it('digests, signs, and verifies a terminal-control envelope', async () => {
    const trusted = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const payload: MatrixCorpusTerminalControlV1 = {
      version: 1,
      eventId: 'terminal_event_1',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '7',
      createdAt: issuedAt,
      kind: 'abandoned',
      tombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    };
    const payloadDigest = sha256(canonicalMatrixCorpusTerminalControlV1(payload));
    expect(digestMatrixCorpusAttestationPayload(payload)).toBe(payloadDigest);
    const signed = await signMatrixCorpusAttestation(
      {
        kind: 'matrix_corpus_terminal_control',
        eventId: payload.eventId,
        leaseFence: payload.leaseFence,
        payloadDigest,
        issuedAt,
        expiresAt,
        payload,
      },
      { keyVersion, privateKey: trusted.privateKey }
    );
    if (!signed.ok) throw new Error(`terminal fixture signing failed: ${signed.code}`);
    const envelope: MatrixCorpusSignedTerminalControlV1 = {
      version: 1,
      kind: 'matrix_corpus_terminal_control',
      eventId: payload.eventId,
      leaseFence: payload.leaseFence,
      payloadDigest,
      attestation: signed.attestation,
    };

    await expect(
      verifyMatrixCorpusAttestation(envelope, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, claims: { payload } });
  });

  it('fails closed for invalid signing inputs, unusable keys, and signing with a public key', async () => {
    const trusted = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const payload = ingestPayload();
    const payloadDigest = digestMatrixCorpusAttestationPayload(payload);
    const input = {
      kind: 'matrix_corpus_ingest' as const,
      eventId: payload.context.ingestReceiptId,
      leaseFence: payload.context.leaseFence,
      payloadDigest,
      issuedAt,
      expiresAt,
      payload,
    };

    expect(() => digestMatrixCorpusAttestationPayload({ invalid: true })).toThrow(
      'Invalid Matrix corpus attestation payload'
    );
    await expect(
      signMatrixCorpusAttestation(input, {
        keyVersion,
        privateKey: {} as KeyLike,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_KEY_CONFIGURATION' });
    await expect(
      signMatrixCorpusAttestation({ ...input, eventId: '' }, { keyVersion, privateKey: trusted.privateKey })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
    await expect(
      signMatrixCorpusAttestation(
        { ...input, payloadDigest: 'f'.repeat(64) },
        { keyVersion, privateKey: trusted.privateKey }
      )
    ).resolves.toEqual({ ok: false, code: 'PAYLOAD_DIGEST_MISMATCH' });
    await expect(
      signMatrixCorpusAttestation(input, { keyVersion, privateKey: trusted.publicKey })
    ).resolves.toEqual({ ok: false, code: 'SIGNING_FAILED' });
  });

  it('rejects malformed algorithms headers signatures and closed-claim violations', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const wrong = await generateKeyPair('EdDSA');
    const { envelope, claims } = await signedIngest(trusted.privateKey);
    const verification = {
      keyring: new Map([[keyVersion, trusted.publicKey]]),
      now: () => '2026-07-20T00:04:00.000Z',
    } as const;
    const unsupported = (alg: string): string => {
      const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT', kid: keyVersion })).toString(
        'base64url'
      );
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${header}.${payload}.AA`;
    };
    const unknownHeader = await rawAttestation(claims, trusted.privateKey, {
      alg: 'EdDSA',
      typ: 'JWT',
      kid: keyVersion,
      extra: 'rejected',
    });
    const missingKid = await rawAttestation(claims, trusted.privateKey, {
      alg: 'EdDSA',
      typ: 'JWT',
    });
    const oversizedKeyId = await rawAttestation(claims, trusted.privateKey, {
      alg: 'EdDSA',
      typ: 'JWT',
      kid: 'k'.repeat(129),
    });
    const oversizedCompact = `${Buffer.from(
      JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: keyVersion })
    ).toString('base64url')}.${'A'.repeat(MATRIX_CORPUS_MAX_COMPACT_JWS_CODE_UNITS)}.AA`;
    const wrongSignature = await signedIngest(wrong.privateKey);
    const unknownClaim = await rawAttestation(
      { ...claims, extra: 'rejected' },
      trusted.privateKey
    );
    const unknownPayload = await rawAttestation(
      { ...claims, payload: { ...claims.payload, extra: 'rejected' } },
      trusted.privateKey
    );
    const cases = [
      { attestation: 'not-a-compact-jws', code: 'MALFORMED' },
      { attestation: unsupported('none'), code: 'INVALID_HEADER' },
      { attestation: unsupported('HS256'), code: 'INVALID_HEADER' },
      { attestation: unsupported('RS256'), code: 'INVALID_HEADER' },
      { attestation: unknownHeader, code: 'INVALID_HEADER' },
      { attestation: missingKid, code: 'INVALID_HEADER' },
      { attestation: oversizedKeyId, code: 'INVALID_HEADER' },
      { attestation: oversizedCompact, code: 'MALFORMED' },
      { attestation: wrongSignature.envelope.attestation, code: 'INVALID_SIGNATURE' },
      { attestation: unknownClaim, code: 'INVALID_CLAIMS' },
      { attestation: unknownPayload, code: 'INVALID_CLAIMS' },
    ] as const;

    for (const testCase of cases)
      await expect(
        verifyMatrixCorpusAttestation(
          { ...envelope, attestation: testCase.attestation },
          verification
        ),
        testCase.code
      ).resolves.toEqual({ ok: false, code: testCase.code });
  });

  it('rejects time identity outer-envelope and canonical payload mismatches', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const { envelope, claims } = await signedIngest(trusted.privateKey);
    const keyring = new Map([[keyVersion, trusted.publicKey]]);
    const verifyAt = (now: string, candidate: unknown = envelope) =>
      verifyMatrixCorpusAttestation(candidate, { keyring, now: () => now });

    for (const invalidEnvelope of [0, 'invalid', null, [], {}, { attestation: 7 }])
      await expect(verifyAt('2026-07-20T00:04:00.000Z', invalidEnvelope)).resolves.toEqual({
        ok: false,
        code: 'INVALID_ENVELOPE',
      });

    await expect(verifyAt('2026-07-20T00:05:30.000Z')).resolves.toMatchObject({ ok: true });
    await expect(verifyAt('2026-07-20T00:05:30.001Z')).resolves.toEqual({
      ok: false,
      code: 'EXPIRED',
    });
    await expect(verifyAt('2026-07-19T23:59:29.999Z')).resolves.toEqual({
      ok: false,
      code: 'NOT_YET_VALID',
    });
    await expect(verifyAt('not-a-time')).resolves.toEqual({
      ok: false,
      code: 'INVALID_CLAIMS',
    });

    const invalidUtf8 = await new CompactSign(new Uint8Array([0xff]))
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: keyVersion })
      .sign(trusted.privateKey);
    await expect(
      verifyAt('2026-07-20T00:04:00.000Z', { ...envelope, attestation: invalidUtf8 })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });

    for (const candidate of [
      { ...envelope, ingestReceiptId: 'receipt_changed' },
      { ...envelope, leaseFence: '8' },
      { ...envelope, payloadDigest: 'f'.repeat(64) },
      { ...envelope, extra: 'rejected' },
    ])
      await expect(verifyAt('2026-07-20T00:04:00.000Z', candidate)).resolves.toEqual({
        ok: false,
        code: 'INVALID_ENVELOPE',
      });

    for (const changedClaims of [
      { ...claims, issuer: 'another-service' },
      { ...claims, audience: 'another-agent' },
      { ...claims, runtimeAudience: 'production' },
      { ...claims, keyVersion: 'key_changed' },
      { ...claims, eventId: 'receipt_changed' },
      { ...claims, leaseFence: '8' },
      { ...claims, payloadDigest: 'f'.repeat(64) },
    ]) {
      const attestation = await rawAttestation(changedClaims, trusted.privateKey);
      await expect(
        verifyAt('2026-07-20T00:04:00.000Z', { ...envelope, attestation })
      ).resolves.toMatchObject({ ok: false });
    }

    const digestMismatch = await rawAttestation(
      { ...claims, payloadDigest: 'f'.repeat(64) },
      trusted.privateKey
    );
    await expect(
      verifyAt('2026-07-20T00:04:00.000Z', { ...envelope, payloadDigest: 'f'.repeat(64), attestation: digestMismatch })
    ).resolves.toEqual({ ok: false, code: 'PAYLOAD_DIGEST_MISMATCH' });
  });
});
