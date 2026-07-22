import {
  createCipheriv,
  createDecipheriv,
  randomBytes as nodeRandomBytes,
} from 'node:crypto';

import {
  intexAgentToolNameV1Schema,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusTransportMessageIdSchema,
} from '@intexuraos/http-contracts';

const AES_256_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_AUTHENTICATION_TAG_BYTES = 16;
const MAX_ENCRYPTED_CONTEXT_UTF8_BYTES = 262_144;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface MatrixCorpusEncryptedValueV1 {
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
}

type MatrixCorpusContextEncryptionBindingBaseV1 = Readonly<{
  version: 1;
  runtimeAudience: 'home-dev';
  runId: string;
  userId: string;
  leaseFence: string;
}>;

export type MatrixCorpusContextEncryptionBindingV1 =
  | Readonly<
      MatrixCorpusContextEncryptionBindingBaseV1 & {
        kind: 'run_prompt_context';
      }
    >
  | Readonly<
      MatrixCorpusContextEncryptionBindingBaseV1 & {
        kind: 'scenario_prompt_context';
        scenarioId: string;
      }
    >
  | Readonly<
      MatrixCorpusContextEncryptionBindingBaseV1 & {
        kind: 'test_confirmation_tool_args';
        scenarioId: string;
        sessionId: string;
        confirmationId: string;
        toolName: string;
        selectionTurnIndex: number;
        selectionOrdinal: number;
        createdAt: string;
        expiresAt: string;
        state: 'pending' | 'resolved';
        decision: 'confirm' | 'reject' | null;
        resolutionMessageId: string | null;
        resolvedAt: string | null;
      }
    >;

export type MatrixCorpusContextCryptoErrorCode =
  | 'INVALID_KEY_CONFIGURATION'
  | 'INVALID_BINDING'
  | 'INVALID_NONCE'
  | 'PLAINTEXT_TOO_LARGE'
  | 'UNKNOWN_KEY_VERSION'
  | 'INVALID_ENCRYPTED_VALUE'
  | 'AUTHENTICATION_FAILED';

export class MatrixCorpusContextCryptoError extends Error {
  readonly code: MatrixCorpusContextCryptoErrorCode;

  constructor(code: MatrixCorpusContextCryptoErrorCode) {
    super(code);
    this.name = 'MatrixCorpusContextCryptoError';
    this.code = code;
  }
}

export interface MatrixCorpusContextCrypto {
  encrypt(
    plaintext: string,
    binding: MatrixCorpusContextEncryptionBindingV1
  ): MatrixCorpusEncryptedValueV1;
  decrypt(
    encrypted: MatrixCorpusEncryptedValueV1,
    binding: MatrixCorpusContextEncryptionBindingV1
  ): string;
}

export interface CreateMatrixCorpusContextCryptoOptions {
  key: Uint8Array;
  keyVersion: string;
  randomBytes?: (size: number) => Uint8Array;
}

export function createMatrixCorpusContextCrypto(
  options: CreateMatrixCorpusContextCryptoOptions
): MatrixCorpusContextCrypto {
  const key = Buffer.from(options.key);
  if (key.byteLength !== AES_256_KEY_BYTES || !matrixCorpusSafeIdSchema.safeParse(options.keyVersion).success)
    throw new MatrixCorpusContextCryptoError('INVALID_KEY_CONFIGURATION');

  const randomBytes = options.randomBytes ?? nodeRandomBytes;

  return {
    encrypt(plaintext, binding): MatrixCorpusEncryptedValueV1 {
      const associatedData = encodeAssociatedData(binding);
      const plaintextBytes = Buffer.from(plaintext, 'utf8');
      if (plaintextBytes.byteLength > MAX_ENCRYPTED_CONTEXT_UTF8_BYTES)
        throw new MatrixCorpusContextCryptoError('PLAINTEXT_TOO_LARGE');

      const nonce = Buffer.from(randomBytes(AES_GCM_NONCE_BYTES));
      if (nonce.byteLength !== AES_GCM_NONCE_BYTES)
        throw new MatrixCorpusContextCryptoError('INVALID_NONCE');

      const cipher = createCipheriv('aes-256-gcm', key, nonce, {
        authTagLength: AES_GCM_AUTHENTICATION_TAG_BYTES,
      });
      cipher.setAAD(associatedData);
      const ciphertext = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
      return {
        algorithm: 'aes-256-gcm',
        keyVersion: options.keyVersion,
        nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        authenticationTag: cipher.getAuthTag().toString('base64url'),
      };
    },

    decrypt(encrypted, binding): string {
      const associatedData = encodeAssociatedData(binding);
      if (encrypted.keyVersion !== options.keyVersion)
        throw new MatrixCorpusContextCryptoError('UNKNOWN_KEY_VERSION');
      const parsed = parseEncryptedValue(encrypted);

      try {
        const decipher = createDecipheriv('aes-256-gcm', key, parsed.nonce, {
          authTagLength: AES_GCM_AUTHENTICATION_TAG_BYTES,
        });
        decipher.setAAD(associatedData);
        decipher.setAuthTag(parsed.authenticationTag);
        const plaintext = Buffer.concat([
          decipher.update(parsed.ciphertext),
          decipher.final(),
        ]);
        return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      } catch {
        throw new MatrixCorpusContextCryptoError('AUTHENTICATION_FAILED');
      }
    },
  };
}

function encodeAssociatedData(binding: MatrixCorpusContextEncryptionBindingV1): Buffer {
  if (!isValidBinding(binding)) throw new MatrixCorpusContextCryptoError('INVALID_BINDING');
  return Buffer.from(
    JSON.stringify({
      version: binding.version,
      kind: binding.kind,
      runtimeAudience: binding.runtimeAudience,
      runId: binding.runId,
      userId: binding.userId,
      leaseFence: binding.leaseFence,
      ...('scenarioId' in binding ? { scenarioId: binding.scenarioId } : {}),
      ...('sessionId' in binding ? { sessionId: binding.sessionId } : {}),
      ...('confirmationId' in binding ? { confirmationId: binding.confirmationId } : {}),
      ...(binding.kind === 'test_confirmation_tool_args'
        ? {
            toolName: binding.toolName,
            selectionTurnIndex: binding.selectionTurnIndex,
            selectionOrdinal: binding.selectionOrdinal,
            createdAt: binding.createdAt,
            expiresAt: binding.expiresAt,
            state: binding.state,
            decision: binding.decision,
            resolutionMessageId: binding.resolutionMessageId,
            resolvedAt: binding.resolvedAt,
          }
        : {}),
    }),
    'utf8'
  );
}

function isValidBinding(binding: MatrixCorpusContextEncryptionBindingV1): boolean {
  const raw = binding as unknown as Record<string, unknown>;
  const commonValid =
    raw['version'] === 1 &&
    raw['runtimeAudience'] === 'home-dev' &&
    matrixCorpusSafeIdSchema.safeParse(binding.runId).success &&
    matrixCorpusSafeIdSchema.safeParse(binding.userId).success &&
    matrixCorpusDecimalFenceSchema.safeParse(binding.leaseFence).success;
  if (!commonValid) return false;
  if (raw['kind'] === 'run_prompt_context')
    return (
      raw['scenarioId'] === undefined &&
      raw['sessionId'] === undefined &&
      raw['confirmationId'] === undefined
    );
  if (raw['kind'] === 'scenario_prompt_context')
    return (
      matrixCorpusSafeIdSchema.safeParse(raw['scenarioId']).success &&
      raw['sessionId'] === undefined &&
      raw['confirmationId'] === undefined
    );
  return (
    raw['kind'] === 'test_confirmation_tool_args' &&
    matrixCorpusSafeIdSchema.safeParse(raw['scenarioId']).success &&
    matrixCorpusSafeIdSchema.safeParse(raw['sessionId']).success &&
    matrixCorpusSafeIdSchema.safeParse(raw['confirmationId']).success &&
    intexAgentToolNameV1Schema.safeParse(raw['toolName']).success &&
    Number.isInteger(raw['selectionTurnIndex']) &&
    Number(raw['selectionTurnIndex']) >= 0 &&
    Number(raw['selectionTurnIndex']) <= 19 &&
    Number.isInteger(raw['selectionOrdinal']) &&
    Number(raw['selectionOrdinal']) >= 1 &&
    Number(raw['selectionOrdinal']) <= 20 &&
    isRfc3339(raw['createdAt']) &&
    isRfc3339(raw['expiresAt']) &&
    hasValidConfirmationResolutionBinding(raw)
  );
}

function hasValidConfirmationResolutionBinding(binding: Record<string, unknown>): boolean {
  if (binding['state'] === 'pending')
    return (
      binding['decision'] === null &&
      binding['resolutionMessageId'] === null &&
      binding['resolvedAt'] === null
    );
  return (
    binding['state'] === 'resolved' &&
    (binding['decision'] === 'confirm' || binding['decision'] === 'reject') &&
    matrixCorpusTransportMessageIdSchema.safeParse(binding['resolutionMessageId']).success &&
    isRfc3339(binding['resolvedAt'])
  );
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseEncryptedValue(encrypted: MatrixCorpusEncryptedValueV1): Readonly<{
  nonce: Buffer;
  ciphertext: Buffer;
  authenticationTag: Buffer;
}> {
  const raw = encrypted as unknown as Record<string, unknown>;
  if (
    raw['algorithm'] !== 'aes-256-gcm' ||
    !isCanonicalBase64url(encrypted.nonce) ||
    !isCanonicalBase64url(encrypted.ciphertext, true) ||
    !isCanonicalBase64url(encrypted.authenticationTag)
  )
    throw new MatrixCorpusContextCryptoError('INVALID_ENCRYPTED_VALUE');

  const nonce = Buffer.from(encrypted.nonce, 'base64url');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64url');
  const authenticationTag = Buffer.from(encrypted.authenticationTag, 'base64url');
  if (
    nonce.byteLength !== AES_GCM_NONCE_BYTES ||
    authenticationTag.byteLength !== AES_GCM_AUTHENTICATION_TAG_BYTES ||
    ciphertext.byteLength > MAX_ENCRYPTED_CONTEXT_UTF8_BYTES
  )
    throw new MatrixCorpusContextCryptoError('INVALID_ENCRYPTED_VALUE');

  return { nonce, ciphertext, authenticationTag };
}

function isCanonicalBase64url(value: string, allowEmpty = false): boolean {
  if (value === '') return allowEmpty;
  if (value.length % 4 === 1 || !BASE64URL_PATTERN.test(value)) return false;
  return Buffer.from(value, 'base64url').toString('base64url') === value;
}
