import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { err, ok, type Result } from '@intexuraos/common-core';
import { z } from 'zod';
import type { WhatsAppError } from '../../domain/whatsapp/models/error.js';
import type { PrivateDigestSourceRevisionClaims } from '../../domain/whatsapp/models/PrivateWhatsAppDigestSource.js';
import type {
  PrivateDigestSourceCursorClaims,
  PrivateDigestSourceHighWatermarkClaims,
  PrivateDigestSourceMessageReferenceClaims,
  PrivateDigestSourceRouteBinding,
  PrivateDigestSourceTokenCodec,
} from '../../domain/whatsapp/ports/privateWhatsAppDigestSourceRepository.js';

export type PrivateDigestSourceKeyPurpose =
  | 'cursor'
  | 'source_revision'
  | 'high_watermark'
  | 'message_ref';

export interface PrivateDigestSourceTokenKey {
  version: string;
  secret: string;
}

export interface PrivateDigestSourceTokenConfig {
  currentKey: PrivateDigestSourceTokenKey;
  previousKeys?: PrivateDigestSourceTokenKey[] | undefined;
  now?: (() => number) | undefined;
  ttlMs?: number | undefined;
}

const TOKEN_PREFIX = 'dgs1';
const TOKEN_PAYLOAD_VERSION = 1;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;
const MAX_ISSUED_AT_SKEW_MS = 30 * 1000;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HKDF_SALT = Buffer.from('intexuraos/private-whatsapp-digest-source/v1', 'utf8');

const positionSchema = z
  .object({
    eventTimestamp: z.string().datetime({ offset: true }),
    messageId: z.string().min(1),
  })
  .strict();

const routeBindingSchema = z
  .object({
    userId: z.string().min(1),
    sourceAccountId: z.string().min(1),
    generationId: z.string().min(1),
    chatId: z.string().min(1),
    chatType: z.enum(['group', 'direct']),
    windowStart: z.string().datetime({ offset: true }),
    windowEnd: z.string().datetime({ offset: true }),
  })
  .strict();

const cursorClaimsSchema = routeBindingSchema.extend({
  watermark: positionSchema,
  position: positionSchema,
  validatedContextSequence: z.number().int().nonnegative(),
  sourceRevision: z.string().min(1),
  highWatermark: z.string().min(1),
});

const cursorEnvelopeSchema = z
  .object({
    version: z.literal(TOKEN_PAYLOAD_VERSION),
    purpose: z.literal('cursor'),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    claims: cursorClaimsSchema,
  })
  .strict();

interface TokenEnvelope<T> {
  version: typeof TOKEN_PAYLOAD_VERSION;
  purpose: Exclude<PrivateDigestSourceKeyPurpose, 'message_ref'>;
  issuedAt: number;
  expiresAt: number;
  claims: T;
}

interface DerivedTokenKey {
  version: string;
  cursor: Buffer;
  sourceRevision: Buffer;
  highWatermark: Buffer;
  messageRef: Buffer;
}

export function derivePrivateDigestSourceKey(
  secret: string,
  purpose: PrivateDigestSourceKeyPurpose
): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      HKDF_SALT,
      Buffer.from(`intexuraos/private-whatsapp-digest-source/${purpose}/v1`, 'utf8'),
      32
    )
  );
}

export function createPrivateDigestSourceTokenCodec(
  config: PrivateDigestSourceTokenConfig
): PrivateDigestSourceTokenCodec {
  const now = config.now ?? Date.now;
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  validateTokenConfig(config, ttlMs);
  const allKeys = [config.currentKey, ...(config.previousKeys ?? [])];
  const keys = new Map(allKeys.map((key) => [key.version, deriveTokenKey(key)]));
  const current = keys.get(config.currentKey.version) as DerivedTokenKey;

  return {
    issueSourceRevision(
      claims: PrivateDigestSourceRevisionClaims
    ): Result<string, WhatsAppError> {
      return sealToken({
        prefix: TOKEN_PREFIX,
        keyVersion: current.version,
        key: current.sourceRevision,
        purpose: 'source_revision',
        claims,
        aad: purposeAad('source_revision'),
        issuedAt: now(),
        ttlMs,
      });
    },

    issueHighWatermark(
      claims: PrivateDigestSourceHighWatermarkClaims
    ): Result<string, WhatsAppError> {
      return sealToken({
        prefix: TOKEN_PREFIX,
        keyVersion: current.version,
        key: current.highWatermark,
        purpose: 'high_watermark',
        claims,
        aad: purposeAad('high_watermark'),
        issuedAt: now(),
        ttlMs,
      });
    },

    issueCursor(claims: PrivateDigestSourceCursorClaims): Result<string, WhatsAppError> {
      return sealToken({
        prefix: TOKEN_PREFIX,
        keyVersion: current.version,
        key: current.cursor,
        purpose: 'cursor',
        claims,
        aad: cursorAad(claims),
        issuedAt: now(),
        ttlMs,
      });
    },

    readCursor(input: {
      token: string;
      binding: PrivateDigestSourceRouteBinding;
    }): Result<PrivateDigestSourceCursorClaims, WhatsAppError> {
      try {
        const tokenParts = parseTokenParts(input.token);
        if (tokenParts === undefined) return invalidCursor();
        const key = keys.get(tokenParts.keyVersion);
        if (key === undefined) return invalidCursor();
        const plaintext = decryptToken(
          tokenParts.encrypted,
          key.cursor,
          cursorAad(input.binding)
        );
        if (plaintext === undefined) return invalidCursor();
        const parsedEnvelope: unknown = JSON.parse(plaintext);
        const envelope = cursorEnvelopeSchema.safeParse(parsedEnvelope);
        if (!envelope.success) return invalidCursor();
        const currentTime = now();
        if (
          envelope.data.issuedAt > currentTime + MAX_ISSUED_AT_SKEW_MS ||
          envelope.data.expiresAt <= currentTime ||
          envelope.data.expiresAt <= envelope.data.issuedAt ||
          envelope.data.expiresAt - envelope.data.issuedAt > MAX_TTL_MS ||
          !sameBinding(envelope.data.claims, input.binding)
        ) {
          return invalidCursor();
        }
        return ok(envelope.data.claims);
      } catch {
        return invalidCursor();
      }
    },

    createMessageRef(claims: PrivateDigestSourceMessageReferenceClaims): string {
      return createHmac('sha256', current.messageRef)
        .update(messageReferenceMaterial(claims), 'utf8')
        .digest('hex');
    },
  };
}

function deriveTokenKey(key: PrivateDigestSourceTokenKey): DerivedTokenKey {
  return {
    version: key.version,
    cursor: derivePrivateDigestSourceKey(key.secret, 'cursor'),
    sourceRevision: derivePrivateDigestSourceKey(key.secret, 'source_revision'),
    highWatermark: derivePrivateDigestSourceKey(key.secret, 'high_watermark'),
    messageRef: derivePrivateDigestSourceKey(key.secret, 'message_ref'),
  };
}

function validateTokenConfig(config: PrivateDigestSourceTokenConfig, ttlMs: number): void {
  const keys = [config.currentKey, ...(config.previousKeys ?? [])];
  if (
    keys.length === 0 ||
    keys.some(
      (key) => !/^[A-Za-z0-9_-]{1,32}$/u.test(key.version) || key.secret.length === 0
    ) ||
    new Set(keys.map((key) => key.version)).size !== keys.length ||
    !Number.isInteger(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > MAX_TTL_MS
  ) {
    throw new Error('Invalid private digest source token configuration');
  }
}

function sealToken<T>(input: {
  prefix: string;
  keyVersion: string;
  key: Buffer;
  purpose: TokenEnvelope<T>['purpose'];
  claims: T;
  aad: Buffer;
  issuedAt: number;
  ttlMs: number;
}): Result<string, WhatsAppError> {
  try {
    const envelope: TokenEnvelope<T> = {
      version: TOKEN_PAYLOAD_VERSION,
      purpose: input.purpose,
      issuedAt: input.issuedAt,
      expiresAt: input.issuedAt + input.ttlMs,
      claims: input.claims,
    };
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', input.key, iv);
    cipher.setAAD(input.aad);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(envelope), 'utf8'),
      cipher.final(),
    ]);
    const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
    return ok(`${input.prefix}.${input.keyVersion}.${encrypted}`);
  } catch {
    return err({ code: 'INTERNAL_ERROR', message: 'Failed to issue private digest token' });
  }
}

function parseTokenParts(
  token: string
): { keyVersion: string; encrypted: Buffer } | undefined {
  const parts = token.split('.');
  if (
    parts.length !== 3 ||
    parts[0] !== TOKEN_PREFIX ||
    parts[1] === undefined ||
    !/^[A-Za-z0-9_-]{1,32}$/u.test(parts[1]) ||
    parts[2] === undefined ||
    !/^[A-Za-z0-9_-]+$/u.test(parts[2])
  ) {
    return undefined;
  }
  const encoded = parts[2];
  const encrypted = Buffer.from(encoded, 'base64url');
  if (encrypted.toString('base64url') !== encoded) return undefined;
  return encrypted.length > IV_LENGTH + AUTH_TAG_LENGTH
    ? { keyVersion: parts[1], encrypted }
    : undefined;
}

function decryptToken(encrypted: Buffer, key: Buffer, aad: Buffer): string | undefined {
  try {
    const iv = encrypted.subarray(0, IV_LENGTH);
    const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

function cursorAad(binding: PrivateDigestSourceRouteBinding): Buffer {
  return Buffer.from(
    [
      TOKEN_PREFIX,
      'cursor',
      binding.userId,
      binding.sourceAccountId,
      binding.generationId,
      binding.chatId,
      binding.chatType,
      binding.windowStart,
      binding.windowEnd,
    ].join('\0'),
    'utf8'
  );
}

function purposeAad(
  purpose: Exclude<PrivateDigestSourceKeyPurpose, 'cursor' | 'message_ref'>
): Buffer {
  return Buffer.from(`${TOKEN_PREFIX}\0${purpose}`, 'utf8');
}

function messageReferenceMaterial(claims: PrivateDigestSourceMessageReferenceClaims): string {
  return [
    TOKEN_PREFIX,
    'message_ref',
    claims.userId,
    claims.sourceAccountId,
    claims.generationId,
    claims.chatId,
    claims.chatType,
    claims.windowStart,
    claims.windowEnd,
    claims.messageId,
    claims.projectionKey,
  ].join('\0');
}

function sameBinding(
  left: PrivateDigestSourceRouteBinding,
  right: PrivateDigestSourceRouteBinding
): boolean {
  return (
    left.userId === right.userId &&
    left.sourceAccountId === right.sourceAccountId &&
    left.generationId === right.generationId &&
    left.chatId === right.chatId &&
    left.chatType === right.chatType &&
    left.windowStart === right.windowStart &&
    left.windowEnd === right.windowEnd
  );
}

function invalidCursor(): Result<never, WhatsAppError> {
  return err({ code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' });
}
