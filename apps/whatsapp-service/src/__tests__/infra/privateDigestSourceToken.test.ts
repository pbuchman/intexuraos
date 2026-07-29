import { createCipheriv } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  PrivateDigestSourceCursorClaims,
  PrivateDigestSourceRouteBinding,
  PrivateDigestSourceTokenCodec,
} from '../../domain/whatsapp/ports/privateWhatsAppDigestSourceRepository.js';
import {
  createPrivateDigestSourceTokenCodec,
  derivePrivateDigestSourceKey,
} from '../../infra/security/privateDigestSourceToken.js';

const binding: PrivateDigestSourceRouteBinding = {
  userId: 'synthetic-user',
  sourceAccountId: 'synthetic-account',
  generationId: 'synthetic-generation',
  chatId: 'synthetic-chat',
  chatType: 'group',
  windowStart: '2026-07-27T00:00:00.000Z',
  windowEnd: '2026-07-28T00:00:00.000Z',
};

const cursorClaims: PrivateDigestSourceCursorClaims = {
  ...binding,
  watermark: {
    eventTimestamp: '2026-07-27T11:00:00.000Z',
    messageId: 'synthetic-message-high',
  },
  position: {
    eventTimestamp: '2026-07-27T10:00:00.000Z',
    messageId: 'synthetic-message-page',
  },
  validatedContextSequence: 12,
  sourceRevision: 'opaque-source-revision',
  highWatermark: 'opaque-high-watermark',
};

function codec(
  options: {
    now?: () => number;
    currentVersion?: string;
    currentSecret?: string;
    previousKeys?: { version: string; secret: string }[];
  } = {}
): PrivateDigestSourceTokenCodec {
  return createPrivateDigestSourceTokenCodec({
    currentKey: {
      version: options.currentVersion ?? 'key-v1',
      secret: options.currentSecret ?? 'synthetic-current-internal-auth-secret',
    },
    previousKeys: options.previousKeys ?? [],
    now: options.now ?? ((): number => Date.parse('2026-07-27T12:00:00.000Z')),
    ttlMs: 60_000,
  });
}

describe('private digest source token security', () => {
  it('round-trips an AES-256-GCM cursor without exposing its claims', () => {
    const tokens = codec();
    const issued = tokens.issueCursor(cursorClaims);

    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error(issued.error.message);
    expect(issued.value).toMatch(/^dgs1\.key-v1\.[A-Za-z0-9_-]+$/u);
    expect(issued.value).not.toContain('synthetic-user');
    expect(issued.value).not.toContain('synthetic-message');
    expect(tokens.readCursor({ token: issued.value, binding })).toEqual({
      ok: true,
      value: cursorClaims,
    });
  });

  it('authenticates ciphertext and every route parameter as additional data', () => {
    const tokens = codec();
    const issued = tokens.issueCursor(cursorClaims);
    if (!issued.ok) throw new Error(issued.error.message);
    const tampered = nonCanonicalAlias(issued.value);

    expect(tokens.readCursor({ token: tampered, binding })).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
    });
    expect(
      tokens.readCursor({
        token: issued.value,
        binding: { ...binding, chatId: 'different-chat' },
      })
    ).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
    });
    expect(
      tokens.readCursor({
        token: issued.value,
        binding: { ...binding, windowEnd: '2026-07-29T00:00:00.000Z' },
      })
    ).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
    });
  });

  it('derives purpose-specific 256-bit keys with HKDF domain separation', () => {
    const secret = 'synthetic-internal-auth-secret';
    const cursor = derivePrivateDigestSourceKey(secret, 'cursor');
    const revision = derivePrivateDigestSourceKey(secret, 'source_revision');
    const watermark = derivePrivateDigestSourceKey(secret, 'high_watermark');
    const reference = derivePrivateDigestSourceKey(secret, 'message_ref');

    expect(cursor).toHaveLength(32);
    expect(revision).toHaveLength(32);
    expect(watermark).toHaveLength(32);
    expect(reference).toHaveLength(32);
    expect(
      new Set([cursor, revision, watermark, reference].map((key) => key.toString('hex'))).size
    ).toBe(4);
    expect(cursor.toString('utf8')).not.toContain(secret);
  });

  it('enforces token version, issued-at skew, and expiry', () => {
    let now = Date.parse('2026-07-27T12:00:00.000Z');
    const tokens = codec({ now: () => now });
    const issued = tokens.issueCursor(cursorClaims);
    if (!issued.ok) throw new Error(issued.error.message);

    now = Date.parse('2026-07-27T12:01:01.000Z');
    expect(tokens.readCursor({ token: issued.value, binding })).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
    });

    const unsupportedVersion = issued.value.replace(/^dgs1\./u, 'dgs2.');
    expect(tokens.readCursor({ token: unsupportedVersion, binding })).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
    });

    now = Date.parse('2026-07-27T11:58:00.000Z');
    expect(tokens.readCursor({ token: issued.value, binding })).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
    });
  });

  it('accepts a previous derived key during rotation and rejects it after retirement', () => {
    const oldTokens = codec({
      currentVersion: 'key-v1',
      currentSecret: 'synthetic-old-secret',
    });
    const issued = oldTokens.issueCursor(cursorClaims);
    if (!issued.ok) throw new Error(issued.error.message);

    const rotated = codec({
      currentVersion: 'key-v2',
      currentSecret: 'synthetic-new-secret',
      previousKeys: [{ version: 'key-v1', secret: 'synthetic-old-secret' }],
    });
    expect(rotated.readCursor({ token: issued.value, binding })).toEqual({
      ok: true,
      value: cursorClaims,
    });

    const retired = codec({
      currentVersion: 'key-v2',
      currentSecret: 'synthetic-new-secret',
    });
    expect(retired.readCursor({ token: issued.value, binding })).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
    });
  });

  it('issues opaque purpose-separated revision, watermark, and message references', () => {
    const tokens = codec();
    const revision = tokens.issueSourceRevision({
      userId: binding.userId,
      sourceAccountId: binding.sourceAccountId,
      generationId: binding.generationId,
      chatId: binding.chatId,
      chatType: binding.chatType,
      contextChangeSequence: 12,
      windowStart: binding.windowStart,
      windowEnd: binding.windowEnd,
      highWatermark: cursorClaims.watermark,
    });
    const watermark = tokens.issueHighWatermark({
      ...binding,
      watermark: cursorClaims.watermark,
    });
    const firstRef = tokens.createMessageRef({
      ...binding,
      messageId: 'synthetic-message',
      projectionKey: 'content',
    });
    const secondRef = tokens.createMessageRef({
      ...binding,
      messageId: 'synthetic-message',
      projectionKey: 'reaction:synthetic-reaction',
    });

    expect(revision.ok).toBe(true);
    expect(watermark.ok).toBe(true);
    if (!revision.ok || !watermark.ok) throw new Error('Expected opaque tokens');
    expect(revision.value).not.toBe(watermark.value);
    expect(revision.value).not.toContain('synthetic-message');
    expect(watermark.value).not.toContain('synthetic-message');
    expect(firstRef).toMatch(/^[a-f0-9]{64}$/u);
    expect(secondRef).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstRef).not.toBe(secondRef);
  });

  it('returns content-free safe failures without logging decoded tokens or secrets', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tokens = codec();
    const result = tokens.readCursor({ token: 'dgs1.key-v1.invalid-private-token', binding });

    expect(result).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
    });
    expect(JSON.stringify(result)).not.toContain('invalid-private-token');
    expect(JSON.stringify(result)).not.toContain('synthetic-current-internal-auth-secret');
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it('uses safe defaults and rejects invalid configuration and undersized ciphertext', () => {
    const defaults = createPrivateDigestSourceTokenCodec({
      currentKey: {
        version: 'key-default',
        secret: 'synthetic-default-internal-auth-secret',
      },
    });
    expect(defaults.issueCursor(cursorClaims).ok).toBe(true);

    expect(() =>
      createPrivateDigestSourceTokenCodec({
        currentKey: { version: '', secret: 'synthetic-secret' },
      })
    ).toThrow('Invalid private digest source token configuration');
    expect(
      codec().readCursor({
        token: `dgs1.key-v1.${Buffer.alloc(1).toString('base64url')}`,
        binding,
      })
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('fails closed for authenticated non-JSON and schema-invalid cursor plaintext', () => {
    const tokens = codec();
    for (const plaintext of ['not-json', JSON.stringify({ unexpected: true })]) {
      const token = sealCursorPlaintext(plaintext);
      expect(tokens.readCursor({ token, binding })).toEqual({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' },
      });
    }
  });

  it('returns a safe issuance failure when claims cannot be serialized', () => {
    const tokens = codec();
    const result = tokens.issueSourceRevision({
      ...binding,
      contextChangeSequence: BigInt(1) as unknown as number,
      highWatermark: cursorClaims.watermark,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to issue private digest token' },
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-user');
  });
});

function sealCursorPlaintext(plaintext: string): string {
  const key = derivePrivateDigestSourceKey('synthetic-current-internal-auth-secret', 'cursor');
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(
    Buffer.from(
      [
        'dgs1',
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
    )
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  return `dgs1.key-v1.${encrypted}`;
}

function nonCanonicalAlias(token: string): string {
  const [prefix, keyVersion, encoded] = token.split('.');
  if (prefix === undefined || keyVersion === undefined || encoded === undefined) {
    throw new Error('Expected a three-part cursor token');
  }
  const decoded = Buffer.from(encoded, 'base64url');
  for (const candidateCharacter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') {
    const candidate = encoded.slice(0, -1).concat(candidateCharacter);
    if (candidate !== encoded && Buffer.from(candidate, 'base64url').equals(decoded)) {
      return `${prefix}.${keyVersion}.${candidate}`;
    }
  }
  throw new Error('Expected a non-canonical base64url alias');
}
