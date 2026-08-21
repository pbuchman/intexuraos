import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { err, ok, type Result } from '@intexuraos/common-core';
import { z } from 'zod';

const TOKEN_PREFIX = 'mdp1';
const PAYLOAD_VERSION = 1;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 10 * 60 * 1000;
const MAX_ISSUED_AT_SKEW_MS = 30 * 1000;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HKDF_SALT = Buffer.from('intexuraos/message-digest/run-preparation/v1', 'utf8');

const bindingSchema = z
  .object({
    userId: z.string().trim().min(1).max(256),
    definitionId: z.string().regex(/^md_[A-Za-z0-9_-]{3,120}$/u),
  })
  .strict();

const claimsSchema = bindingSchema
  .extend({
    definitionRevision: z.number().int().positive(),
    stateRevision: z.number().int().positive(),
    erasureEpoch: z.number().int().nonnegative(),
    windowStart: z.string().datetime({ offset: true }),
    windowEnd: z.string().datetime({ offset: true }),
    nextRunAt: z.string().datetime({ offset: true }),
    persistedReadinessObservationVersion: z.string().trim().min(1).max(512),
    preparedReadinessObservationVersion: z.string().trim().min(1).max(512),
  })
  .strict()
  .superRefine((claims, context) => {
    if (Date.parse(claims.windowEnd) <= Date.parse(claims.windowStart)) {
      context.addIssue({ code: 'custom', message: 'Run window is empty', path: ['windowEnd'] });
    }
    if (Date.parse(claims.nextRunAt) <= Date.parse(claims.windowEnd)) {
      context.addIssue({
        code: 'custom',
        message: 'Next run must follow the prepared window',
        path: ['nextRunAt'],
      });
    }
  });

const envelopeSchema = z
  .object({
    version: z.literal(PAYLOAD_VERSION),
    purpose: z.literal('run_preparation'),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    claims: claimsSchema,
  })
  .strict();

export interface RunPreparationTokenKey {
  version: string;
  secret: string;
}

export interface RunPreparationTokenConfig {
  currentKey: RunPreparationTokenKey;
  now?: (() => number) | undefined;
  ttlMs?: number | undefined;
}

export interface RunPreparationBinding {
  userId: string;
  definitionId: string;
}

export interface RunPreparationClaims extends RunPreparationBinding {
  definitionRevision: number;
  stateRevision: number;
  erasureEpoch: number;
  windowStart: string;
  windowEnd: string;
  nextRunAt: string;
  persistedReadinessObservationVersion: string;
  preparedReadinessObservationVersion: string;
}

export interface RunPreparationTokenError {
  code: 'INVALID_PREPARATION_TOKEN';
  message: 'Invalid run preparation token';
}

export interface RunPreparationTokenCodec {
  issue(claims: RunPreparationClaims): Result<string, RunPreparationTokenError>;
  read(input: {
    token: string;
    binding: RunPreparationBinding;
  }): Result<RunPreparationClaims, RunPreparationTokenError>;
}

interface DerivedKey {
  version: string;
  value: Buffer;
}

export function deriveRunPreparationTokenKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      HKDF_SALT,
      Buffer.from('intexuraos/message-digest/run-preparation/token/v1', 'utf8'),
      32
    )
  );
}

export function createRunPreparationTokenCodec(
  config: RunPreparationTokenConfig
): RunPreparationTokenCodec {
  const now = config.now ?? Date.now;
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  validateConfig(config, ttlMs);
  const current: DerivedKey = {
    version: config.currentKey.version,
    value: deriveRunPreparationTokenKey(config.currentKey.secret),
  };

  return {
    issue(claims): Result<string, RunPreparationTokenError> {
      const parsedClaims = claimsSchema.safeParse(claims);
      if (!parsedClaims.success) return invalidToken();
      try {
        const issuedAt = now();
        const envelope = {
          version: PAYLOAD_VERSION,
          purpose: 'run_preparation' as const,
          issuedAt,
          expiresAt: issuedAt + ttlMs,
          claims: parsedClaims.data,
        };
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv('aes-256-gcm', current.value, iv);
        cipher.setAAD(additionalData(parsedClaims.data));
        const ciphertext = Buffer.concat([
          cipher.update(JSON.stringify(envelope), 'utf8'),
          cipher.final(),
        ]);
        const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
          'base64url'
        );
        return ok(`${TOKEN_PREFIX}.${current.version}.${encrypted}`);
      } catch {
        return invalidToken();
      }
    },

    read(input): Result<RunPreparationClaims, RunPreparationTokenError> {
      try {
        const parsedBinding = bindingSchema.safeParse(input.binding);
        if (!parsedBinding.success) return invalidToken();
        const parts = parseToken(input.token);
        if (parts?.keyVersion !== current.version) return invalidToken();
        const plaintext = decrypt(
          parts.encrypted,
          current.value,
          additionalData(parsedBinding.data)
        );
        if (plaintext === null) return invalidToken();
        const parsed = envelopeSchema.safeParse(JSON.parse(plaintext) as unknown);
        if (!parsed.success) return invalidToken();
        const currentTime = now();
        if (
          parsed.data.issuedAt > currentTime + MAX_ISSUED_AT_SKEW_MS ||
          parsed.data.expiresAt <= currentTime ||
          parsed.data.expiresAt <= parsed.data.issuedAt ||
          parsed.data.expiresAt - parsed.data.issuedAt > MAX_TTL_MS ||
          parsed.data.claims.userId !== parsedBinding.data.userId ||
          parsed.data.claims.definitionId !== parsedBinding.data.definitionId
        ) {
          return invalidToken();
        }
        return ok(parsed.data.claims);
      } catch {
        return invalidToken();
      }
    },
  };
}

function validateConfig(config: RunPreparationTokenConfig, ttlMs: number): void {
  if (
    !/^[A-Za-z0-9_-]{1,32}$/u.test(config.currentKey.version) ||
    config.currentKey.secret.length === 0 ||
    !Number.isInteger(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > MAX_TTL_MS
  ) {
    throw new Error('Invalid run preparation token configuration');
  }
}

function parseToken(token: string): { keyVersion: string; encrypted: Buffer } | null {
  const parts = token.split('.');
  if (
    parts.length !== 3 ||
    parts[0] !== TOKEN_PREFIX ||
    parts[1] === undefined ||
    !/^[A-Za-z0-9_-]{1,32}$/u.test(parts[1]) ||
    parts[2] === undefined ||
    !/^[A-Za-z0-9_-]+$/u.test(parts[2])
  ) {
    return null;
  }
  const encrypted = Buffer.from(parts[2], 'base64url');
  if (encrypted.toString('base64url') !== parts[2]) return null;
  return encrypted.length > IV_LENGTH + AUTH_TAG_LENGTH
    ? { keyVersion: parts[1], encrypted }
    : null;
}

function decrypt(encrypted: Buffer, key: Buffer, aad: Buffer): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, IV_LENGTH));
    decipher.setAAD(aad);
    decipher.setAuthTag(encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH));
    return Buffer.concat([
      decipher.update(encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

function additionalData(binding: RunPreparationBinding): Buffer {
  return Buffer.from(
    [TOKEN_PREFIX, 'run_preparation', binding.userId, binding.definitionId].join('\0'),
    'utf8'
  );
}

function invalidToken(): Result<never, RunPreparationTokenError> {
  return err({
    code: 'INVALID_PREPARATION_TOKEN',
    message: 'Invalid run preparation token',
  });
}
