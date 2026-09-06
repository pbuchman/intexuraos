import { createHash } from 'node:crypto';

import {
  CompactSign,
  generateKeyPair,
  type CompactJWSHeaderParameters,
  type KeyLike,
} from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MATRIX_CORPUS_MAX_COMPACT_JWS_CODE_UNITS,
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusControlMutationV1,
  canonicalMatrixCorpusTerminalControlV1,
  type MatrixCorpusAttestationClaimsV1,
  type MatrixCorpusAttestedIngestPayloadV1,
  type MatrixCorpusControlMutationV1,
  type MatrixCorpusSignedControlMutationV1,
  type MatrixCorpusSignedIngestV1,
  type MatrixCorpusSignedTerminalControlV1,
  type MatrixCorpusTerminalControlV1,
} from '@intexuraos/http-contracts';

import { verifyMatrixCorpusAttestation } from '../../../domain/matrixCorpus/attestation.js';

const issuedAt = '2026-07-20T00:00:00.000Z';
const expiresAt = '2026-07-20T00:05:00.000Z';
const keyVersion = 'key_v1';

type IngestClaims = Extract<
  MatrixCorpusAttestationClaimsV1,
  Readonly<{ kind: 'matrix_corpus_ingest' }>
>;

afterEach(() => {
  vi.restoreAllMocks();
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function ingestPayload(): MatrixCorpusAttestedIngestPayloadV1 {
  return {
    version: 1,
    kind: 'matrix_corpus_ingest_payload',
    ordinaryIngest: {
      type: 'intex.message.ingest',
      userId: 'private_user_fixture',
      messageId: 'private_message_fixture',
      text: 'private natural-text fixture',
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

function terminalPayload(): MatrixCorpusTerminalControlV1 {
  return {
    version: 1,
    kind: 'abandoned',
    eventId: 'terminal_1',
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    createdAt: issuedAt,
    tombstoneDigest: null,
    terminalCandidateDigest: null,
    artifactStageDigest: null,
  };
}

async function attestation(
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

async function signedIngest(
  privateKey: KeyLike,
  overrides: Readonly<Record<string, unknown>> = {}
): Promise<Readonly<{ envelope: MatrixCorpusSignedIngestV1; claims: IngestClaims }>> {
  const payload = ingestPayload();
  const payloadDigest = sha256(canonicalMatrixCorpusIngestPayloadV1(payload));
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
    ...overrides,
  } satisfies IngestClaims;
  return {
    envelope: {
      version: 1,
      kind: 'matrix_corpus_ingest',
      ingestReceiptId: payload.context.ingestReceiptId,
      leaseFence: payload.context.leaseFence,
      payloadDigest,
      attestation: await attestation(claims, privateKey),
    },
    claims,
  };
}

describe('Intex Agent Matrix corpus attestation verifier', () => {
  it('verifies closed ingest and terminal contracts without logging private fields', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const ingest = await signedIngest(trusted.privateKey);
    const terminal = terminalPayload();
    const terminalDigest = sha256(canonicalMatrixCorpusTerminalControlV1(terminal));
    const terminalClaims = {
      version: 1,
      kind: 'matrix_corpus_terminal_control',
      issuer: 'whatsapp-service',
      audience: 'intex-agent',
      runtimeAudience: 'hetzner-prod',
      keyVersion,
      eventId: terminal.eventId,
      leaseFence: terminal.leaseFence,
      payloadDigest: terminalDigest,
      issuedAt,
      expiresAt,
      payload: terminal,
    } satisfies MatrixCorpusAttestationClaimsV1;
    const terminalEnvelope = {
      version: 1,
      kind: 'matrix_corpus_terminal_control',
      eventId: terminal.eventId,
      leaseFence: terminal.leaseFence,
      payloadDigest: terminalDigest,
      attestation: await attestation(terminalClaims, trusted.privateKey),
    } satisfies MatrixCorpusSignedTerminalControlV1;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const options = {
      keyring: new Map([[keyVersion, trusted.publicKey]]),
      now: () => '2026-07-20T00:05:30.000Z',
    } as const;

    await expect(verifyMatrixCorpusAttestation(ingest.envelope, options)).resolves.toEqual({
      ok: true,
      claims: ingest.claims,
    });
    await expect(verifyMatrixCorpusAttestation(terminalEnvelope, options)).resolves.toEqual({
      ok: true,
      claims: terminalClaims,
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('accepts configured rotation keys and rejects unknown versions before claims acceptance', async () => {
    const current = await generateKeyPair('EdDSA');
    const previous = await generateKeyPair('EdDSA');
    const signed = await signedIngest(previous.privateKey, { keyVersion: 'key_v0' });
    const previousEnvelope = {
      ...signed.envelope,
      attestation: await attestation(signed.claims, previous.privateKey, {
        alg: 'EdDSA',
        typ: 'JWT',
        kid: 'key_v0',
      }),
    };

    await expect(
      verifyMatrixCorpusAttestation(previousEnvelope, {
        keyring: new Map([
          [keyVersion, current.publicKey],
          ['key_v0', previous.publicKey],
        ]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyMatrixCorpusAttestation(previousEnvelope, {
        keyring: new Map([[keyVersion, current.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'UNKNOWN_KEY_VERSION' });
  });

  it('rejects a correctly signed legacy Home Dev audience before accepting claims', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const signed = await signedIngest(trusted.privateKey, { runtimeAudience: 'home-dev' });

    await expect(
      verifyMatrixCorpusAttestation(signed.envelope, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
  });

  it('rejects an explicitly configured Ed448 verification key', async () => {
    const ed448 = await generateKeyPair('EdDSA', { crv: 'Ed448' });
    const signed = await signedIngest(ed448.privateKey);

    await expect(
      verifyMatrixCorpusAttestation(signed.envelope, {
        keyring: new Map([[keyVersion, ed448.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_KEY_CONFIGURATION' });
  });

  it('rejects malformed headers signatures closed-claim violations and altered payloads', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const wrong = await generateKeyPair('EdDSA');
    const signed = await signedIngest(trusted.privateKey);
    const invalidAlgorithm = (algorithm: string): string => {
      const header = Buffer.from(
        JSON.stringify({ alg: algorithm, typ: 'JWT', kid: keyVersion })
      ).toString('base64url');
      const payload = Buffer.from(JSON.stringify(signed.claims)).toString('base64url');
      return `${header}.${payload}.AA`;
    };
    const wrongSignature = await signedIngest(wrong.privateKey);
    const extraHeader = await attestation(signed.claims, trusted.privateKey, {
      alg: 'EdDSA',
      typ: 'JWT',
      kid: keyVersion,
      extra: 'rejected',
    });
    const extraClaim = await attestation(
      { ...signed.claims, extra: 'rejected' },
      trusted.privateKey
    );
    const oversizedKeyId = await attestation(signed.claims, trusted.privateKey, {
      alg: 'EdDSA',
      typ: 'JWT',
      kid: 'k'.repeat(129),
    });
    const oversizedCompact = `${Buffer.from(
      JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: keyVersion })
    ).toString('base64url')}.${'A'.repeat(MATRIX_CORPUS_MAX_COMPACT_JWS_CODE_UNITS)}.AA`;
    const changedPayload = {
      ...signed.claims,
      payload: {
        ...signed.claims.payload,
        ordinaryIngest: { ...signed.claims.payload.ordinaryIngest, text: 'altered' },
      },
    };
    const cases = [
      { attestation: 'not-a-jws', code: 'MALFORMED' },
      { attestation: invalidAlgorithm('none'), code: 'INVALID_HEADER' },
      { attestation: invalidAlgorithm('HS256'), code: 'INVALID_HEADER' },
      { attestation: invalidAlgorithm('RS256'), code: 'INVALID_HEADER' },
      { attestation: extraHeader, code: 'INVALID_HEADER' },
      { attestation: oversizedKeyId, code: 'INVALID_HEADER' },
      { attestation: oversizedCompact, code: 'MALFORMED' },
      { attestation: wrongSignature.envelope.attestation, code: 'INVALID_SIGNATURE' },
      { attestation: extraClaim, code: 'INVALID_CLAIMS' },
      {
        attestation: await attestation(changedPayload, trusted.privateKey),
        code: 'PAYLOAD_DIGEST_MISMATCH',
      },
    ] as const;

    for (const testCase of cases)
      await expect(
        verifyMatrixCorpusAttestation(
          { ...signed.envelope, attestation: testCase.attestation },
          {
            keyring: new Map([[keyVersion, trusted.publicKey]]),
            now: () => '2026-07-20T00:04:00.000Z',
          }
        )
      ).resolves.toEqual({ ok: false, code: testCase.code });
  });

  it('enforces exact outer correlation identity and the closed 30-second clock skew', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const signed = await signedIngest(trusted.privateKey);
    const verifyAt = (
      now: string,
      candidate: unknown = signed.envelope
    ): ReturnType<typeof verifyMatrixCorpusAttestation> =>
      verifyMatrixCorpusAttestation(candidate, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => now,
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

    for (const candidate of [
      { ...signed.envelope, ingestReceiptId: 'changed' },
      { ...signed.envelope, leaseFence: '8' },
      { ...signed.envelope, payloadDigest: 'f'.repeat(64) },
      { ...signed.envelope, extra: 'rejected' },
    ])
      await expect(verifyAt('2026-07-20T00:04:00.000Z', candidate)).resolves.toEqual({
        ok: false,
        code: 'INVALID_ENVELOPE',
      });
  });

  it('verifies the closed control-mutation envelope and payload digest', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const payload: MatrixCorpusControlMutationV1 = {
      version: 1,
      kind: 'register_context',
      eventId: 'control_event_1',
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      requestDigest: 'c'.repeat(64),
      createdAt: issuedAt,
    };
    const payloadDigest = sha256(canonicalMatrixCorpusControlMutationV1(payload));
    const claims = {
      version: 1,
      kind: 'matrix_corpus_control_mutation',
      issuer: 'whatsapp-service',
      audience: 'intex-agent',
      runtimeAudience: 'hetzner-prod',
      keyVersion,
      eventId: payload.eventId,
      leaseFence: payload.leaseFence,
      payloadDigest,
      issuedAt,
      expiresAt,
      payload,
    } satisfies MatrixCorpusAttestationClaimsV1;
    const envelope: MatrixCorpusSignedControlMutationV1 = {
      version: 1,
      kind: 'matrix_corpus_control_mutation',
      eventId: payload.eventId,
      leaseFence: payload.leaseFence,
      payloadDigest,
      attestation: await attestation(claims, trusted.privateKey),
    };

    await expect(
      verifyMatrixCorpusAttestation(envelope, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toEqual({ ok: true, claims });
  });

  it('rejects invalid envelope primitives and malformed signed claim bytes', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const signed = await signedIngest(trusted.privateKey);
    const options = {
      keyring: new Map([[keyVersion, trusted.publicKey]]),
      now: () => '2026-07-20T00:04:00.000Z',
    } as const;
    for (const input of [null, [], 'private', 3, {}, { attestation: 3 }])
      await expect(verifyMatrixCorpusAttestation(input, options)).resolves.toEqual({
        ok: false,
        code: 'INVALID_ENVELOPE',
      });

    for (const bytes of [new TextEncoder().encode('{not-json'), new Uint8Array([0xff])]) {
      const malformed = await new CompactSign(bytes)
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: keyVersion })
        .sign(trusted.privateKey);
      await expect(
        verifyMatrixCorpusAttestation({ ...signed.envelope, attestation: malformed }, options)
      ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
    }
  });

  it('rejects a signed claim whose key version differs from its protected header', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const signed = await signedIngest(trusted.privateKey, { keyVersion: 'key_v0' });
    const mismatched = {
      ...signed.envelope,
      attestation: await attestation(signed.claims, trusted.privateKey),
    };

    await expect(
      verifyMatrixCorpusAttestation(mismatched, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => '2026-07-20T00:04:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
  });

  it('rejects a non-RFC3339 verifier clock after successful signature validation', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const signed = await signedIngest(trusted.privateKey);
    await expect(
      verifyMatrixCorpusAttestation(signed.envelope, {
        keyring: new Map([[keyVersion, trusted.publicKey]]),
        now: () => 'invalid',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_CLAIMS' });
  });
});
