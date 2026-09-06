import { createHash } from 'node:crypto';

import { compactVerify, decodeProtectedHeader, exportJWK, type KeyLike } from 'jose';

import {
  MATRIX_CORPUS_MAX_COMPACT_JWS_CODE_UNITS,
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusControlMutationV1,
  canonicalMatrixCorpusTerminalControlV1,
  matrixCorpusAttestationClaimsV1Schema,
  matrixCorpusAttestedIngestPayloadV1Schema,
  matrixCorpusControlMutationV1Schema,
  matrixCorpusSignedIngestV1Schema,
  matrixCorpusSignedControlMutationV1Schema,
  matrixCorpusSignedTerminalControlV1Schema,
  matrixCorpusSafeIdSchema,
  matrixCorpusTerminalControlV1Schema,
  type MatrixCorpusAttestationClaimsV1,
} from '@intexuraos/http-contracts';

const ACCEPTED_CLOCK_SKEW_MS = 30_000;
const protectedHeaderKeys = ['alg', 'kid', 'typ'] as const;

export type MatrixCorpusAttestationVerificationFailureCode =
  | 'INVALID_ENVELOPE'
  | 'MALFORMED'
  | 'INVALID_HEADER'
  | 'UNKNOWN_KEY_VERSION'
  | 'INVALID_SIGNATURE'
  | 'INVALID_KEY_CONFIGURATION'
  | 'INVALID_CLAIMS'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'PAYLOAD_DIGEST_MISMATCH';

export type MatrixCorpusAttestationVerificationResult =
  | Readonly<{ ok: true; claims: MatrixCorpusAttestationClaimsV1 }>
  | Readonly<{ ok: false; code: MatrixCorpusAttestationVerificationFailureCode }>;

export type MatrixCorpusAttestationVerificationOptions = Readonly<{
  keyring: ReadonlyMap<string, KeyLike>;
  now: () => string;
}>;

type ParsedEnvelope = Readonly<{
  kind:
    | 'matrix_corpus_ingest'
    | 'matrix_corpus_terminal_control'
    | 'matrix_corpus_control_mutation';
  eventId: string;
  leaseFence: string;
  payloadDigest: string;
  attestation: string;
}>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function isEd25519Key(key: KeyLike): Promise<boolean> {
  try {
    const jwk = await exportJWK(key);
    return jwk.kty === 'OKP' && jwk.crv === 'Ed25519';
  } catch {
    return false;
  }
}

function digestAttestedPayload(payload: unknown): string {
  const ingest = matrixCorpusAttestedIngestPayloadV1Schema.safeParse(payload);
  if (ingest.success) return sha256(canonicalMatrixCorpusIngestPayloadV1(ingest.data));

  const terminal = matrixCorpusTerminalControlV1Schema.safeParse(payload);
  if (terminal.success) return sha256(canonicalMatrixCorpusTerminalControlV1(terminal.data));

  const control = matrixCorpusControlMutationV1Schema.safeParse(payload);
  /* v8 ignore start -- upstream: attestation claims schema validates payload as ingest, terminal, or control before digesting; the final invalid branch cannot pass that prior check @preserve */
  if (control.success) return sha256(canonicalMatrixCorpusControlMutationV1(control.data));

  throw new TypeError('Invalid Matrix corpus attestation payload');
  /* v8 ignore stop @preserve */
}

function parseEnvelope(input: unknown): ParsedEnvelope | undefined {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    !('attestation' in input) ||
    typeof input.attestation !== 'string'
  )
    return undefined;

  const shapeCandidate = { ...input, attestation: 'e30.e30.AA' };
  const ingest = matrixCorpusSignedIngestV1Schema.safeParse(shapeCandidate);
  if (ingest.success)
    return {
      kind: ingest.data.kind,
      eventId: ingest.data.ingestReceiptId,
      leaseFence: ingest.data.leaseFence,
      payloadDigest: ingest.data.payloadDigest,
      attestation: input.attestation,
    };

  const terminal = matrixCorpusSignedTerminalControlV1Schema.safeParse(shapeCandidate);
  if (terminal.success)
    return {
      kind: terminal.data.kind,
      eventId: terminal.data.eventId,
      leaseFence: terminal.data.leaseFence,
      payloadDigest: terminal.data.payloadDigest,
      attestation: input.attestation,
    };

  const control = matrixCorpusSignedControlMutationV1Schema.safeParse(shapeCandidate);
  if (control.success)
    return {
      kind: control.data.kind,
      eventId: control.data.eventId,
      leaseFence: control.data.leaseFence,
      payloadDigest: control.data.payloadDigest,
      attestation: input.attestation,
    };

  return undefined;
}

function hasExactProtectedHeader(header: Record<string, unknown>): header is Readonly<{
  alg: 'EdDSA';
  typ: 'JWT';
  kid: string;
}> {
  const keys = Object.keys(header).sort();
  return (
    keys.length === protectedHeaderKeys.length &&
    protectedHeaderKeys.every((key, index) => key === keys[index]) &&
    header['alg'] === 'EdDSA' &&
    header['typ'] === 'JWT' &&
    typeof header['kid'] === 'string' &&
    matrixCorpusSafeIdSchema.safeParse(header['kid']).success
  );
}

export async function verifyMatrixCorpusAttestation(
  input: unknown,
  options: MatrixCorpusAttestationVerificationOptions
): Promise<MatrixCorpusAttestationVerificationResult> {
  const envelope = parseEnvelope(input);
  if (envelope === undefined) return { ok: false, code: 'INVALID_ENVELOPE' };
  if (envelope.attestation.length > MATRIX_CORPUS_MAX_COMPACT_JWS_CODE_UNITS)
    return { ok: false, code: 'MALFORMED' };

  let unverifiedHeader: Record<string, unknown>;
  try {
    unverifiedHeader = decodeProtectedHeader(envelope.attestation);
  } catch {
    return { ok: false, code: 'MALFORMED' };
  }
  if (!hasExactProtectedHeader(unverifiedHeader)) return { ok: false, code: 'INVALID_HEADER' };

  const verificationKey = options.keyring.get(unverifiedHeader.kid);
  if (verificationKey === undefined) return { ok: false, code: 'UNKNOWN_KEY_VERSION' };
  if (!(await isEd25519Key(verificationKey)))
    return { ok: false, code: 'INVALID_KEY_CONFIGURATION' };

  let verifiedBytes: Uint8Array;
  try {
    const verified = await compactVerify(envelope.attestation, verificationKey, {
      algorithms: ['EdDSA'],
    });
    verifiedBytes = verified.payload;
  } catch {
    return { ok: false, code: 'INVALID_SIGNATURE' };
  }

  let decodedClaims: unknown;
  try {
    decodedClaims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(verifiedBytes));
  } catch {
    return { ok: false, code: 'INVALID_CLAIMS' };
  }
  const parsedClaims = matrixCorpusAttestationClaimsV1Schema.safeParse(decodedClaims);
  if (!parsedClaims.success) return { ok: false, code: 'INVALID_CLAIMS' };
  const claims = parsedClaims.data;

  if (claims.runtimeAudience !== 'hetzner-prod')
    return { ok: false, code: 'INVALID_CLAIMS' };
  if (claims.keyVersion !== unverifiedHeader.kid) return { ok: false, code: 'INVALID_CLAIMS' };
  if (
    claims.kind !== envelope.kind ||
    claims.eventId !== envelope.eventId ||
    claims.leaseFence !== envelope.leaseFence ||
    claims.payloadDigest !== envelope.payloadDigest
  )
    return { ok: false, code: 'INVALID_ENVELOPE' };

  let actualDigest: string;
  try {
    actualDigest = digestAttestedPayload(claims.payload);
  } catch {
    return { ok: false, code: 'INVALID_CLAIMS' };
  }
  if (actualDigest !== claims.payloadDigest)
    return { ok: false, code: 'PAYLOAD_DIGEST_MISMATCH' };

  const currentTime = Date.parse(options.now());
  const issuedTime = Date.parse(claims.issuedAt);
  const expiryTime = Date.parse(claims.expiresAt);
  if (!Number.isFinite(currentTime)) return { ok: false, code: 'INVALID_CLAIMS' };
  if (currentTime < issuedTime - ACCEPTED_CLOCK_SKEW_MS)
    return { ok: false, code: 'NOT_YET_VALID' };
  if (currentTime > expiryTime + ACCEPTED_CLOCK_SKEW_MS) return { ok: false, code: 'EXPIRED' };

  return { ok: true, claims };
}
