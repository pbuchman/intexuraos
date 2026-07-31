import { createCipheriv } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createRunPreparationTokenCodec,
  deriveRunPreparationTokenKey,
  type RunPreparationClaims,
  type RunPreparationTokenCodec,
} from './runPreparationToken.js';

const NOW_MS = Date.parse('2026-07-27T12:00:00.000Z');
const binding = {
  userId: 'synthetic-user-001',
  definitionId: 'md_definition_001',
};
const claims: RunPreparationClaims = {
  ...binding,
  definitionRevision: 3,
  stateRevision: 5,
  erasureEpoch: 0,
  windowStart: '2026-07-27T07:00:00.000Z',
  windowEnd: '2026-07-27T12:00:00.000Z',
  nextRunAt: '2026-07-28T07:00:00.000Z',
  persistedReadinessObservationVersion: 'persisted-readiness-v1',
  preparedReadinessObservationVersion: 'prepared-readiness-v1',
};

describe('run preparation token', () => {
  it('round-trips opaque AES-256-GCM claims bound to owner and definition', () => {
    const tokens = codec();
    const issued = tokens.issue(claims);

    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error(issued.error.message);
    expect(issued.value).toMatch(/^mdp1\.key-v1\.[A-Za-z0-9_-]+$/u);
    expect(issued.value).not.toContain(binding.userId);
    expect(issued.value).not.toContain(claims.windowStart);
    expect(tokens.read({ token: issued.value, binding })).toEqual({ ok: true, value: claims });
  });

  it('authenticates ciphertext and every binding field', () => {
    const tokens = codec();
    const issued = tokens.issue(claims);
    if (!issued.ok) throw new Error(issued.error.message);
    const replacement = issued.value.endsWith('A') ? 'B' : 'A';

    expect(tokens.read({ token: `${issued.value.slice(0, -1)}${replacement}`, binding })).toEqual(
      invalidToken()
    );
    expect(
      tokens.read({ token: issued.value, binding: { ...binding, userId: 'another-user' } })
    ).toEqual(invalidToken());
    expect(
      tokens.read({ token: issued.value, binding: { ...binding, definitionId: 'md_other' } })
    ).toEqual(invalidToken());
  });

  it('enforces expiry, issued-at skew, key rotation, and token version', () => {
    let now = NOW_MS;
    const oldTokens = codec({ now: () => now, secret: 'old-secret' });
    const issued = oldTokens.issue(claims);
    if (!issued.ok) throw new Error(issued.error.message);

    const rotated = codec({
      now: () => now,
      version: 'key-v2',
      secret: 'new-secret',
      previousKeys: [{ version: 'key-v1', secret: 'old-secret' }],
    });
    expect(rotated.read({ token: issued.value, binding })).toEqual({ ok: true, value: claims });

    now = NOW_MS + 5 * 60 * 1000 + 1;
    expect(rotated.read({ token: issued.value, binding })).toEqual(invalidToken());
    expect(rotated.read({ token: issued.value.replace(/^mdp1\./u, 'mdp2.'), binding })).toEqual(
      invalidToken()
    );

    now = NOW_MS - 31_000;
    expect(rotated.read({ token: issued.value, binding })).toEqual(invalidToken());
  });

  it('derives a domain-separated 256-bit key and rejects unsafe configuration', () => {
    const key = deriveRunPreparationTokenKey('synthetic-internal-secret');
    expect(key).toHaveLength(32);
    expect(key.toString('utf8')).not.toContain('synthetic-internal-secret');
    expect(() =>
      createRunPreparationTokenCodec({
        currentKey: { version: 'bad version', secret: '' },
      })
    ).toThrow('Invalid run preparation token configuration');
    expect(() =>
      createRunPreparationTokenCodec({
        currentKey: { version: 'key-v1', secret: 'secret' },
        ttlMs: 60 * 60 * 1000,
      })
    ).toThrow('Invalid run preparation token configuration');
  });

  it('returns one content-free failure without logging tokens or claims', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = codec().read({ token: 'mdp1.key-v1.invalid-private-token', binding });

    expect(result).toEqual(invalidToken());
    expect(JSON.stringify(result)).not.toContain('invalid-private-token');
    expect(JSON.stringify(result)).not.toContain(binding.userId);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it('rejects empty windows, non-forward next runs, and malformed claims before encryption', () => {
    const tokens = codec();
    expect(tokens.issue({ ...claims, windowEnd: claims.windowStart })).toEqual(invalidToken());
    expect(tokens.issue({ ...claims, nextRunAt: claims.windowEnd })).toEqual(invalidToken());
    expect(tokens.issue({ ...claims, definitionRevision: 0 })).toEqual(invalidToken());
  });

  it('rejects every malformed token envelope and binding before decryption', () => {
    const tokens = codec();
    for (const token of [
      '',
      'mdp1.key-v1',
      'mdp2.key-v1.abc',
      'mdp1.bad.version.abc',
      'mdp1.key-v1.***',
      'mdp1.key-v1.YQ',
    ]) {
      expect(tokens.read({ token, binding })).toEqual(invalidToken());
    }
    expect(tokens.read({ token: 'mdp1.key-v1.YQ', binding: { ...binding, userId: ' ' } })).toEqual(
      invalidToken()
    );

    const authenticatedInvalidEnvelope = encryptEnvelope({
      version: 1,
      purpose: 'run_preparation',
      issuedAt: NOW_MS,
      expiresAt: NOW_MS + 5 * 60 * 1000,
      claims: { ...claims, definitionRevision: 0 },
    });
    expect(tokens.read({ token: authenticatedInvalidEnvelope, binding })).toEqual(invalidToken());
  });

  it('rejects unknown rotation keys and clock failures with the same safe error', () => {
    const issued = codec({ version: 'old-key', secret: 'old-secret' }).issue(claims);
    if (!issued.ok) throw new Error(issued.error.message);
    expect(codec().read({ token: issued.value, binding })).toEqual(invalidToken());

    const nowThrows = codec({
      now: () => {
        throw new Error('synthetic clock failure');
      },
    });
    expect(nowThrows.issue(claims)).toEqual(invalidToken());

    const normal = codec();
    const normalIssued = normal.issue(claims);
    if (!normalIssued.ok) throw new Error(normalIssued.error.message);
    const reader = createRunPreparationTokenCodec({
      currentKey: { version: 'key-v1', secret: 'synthetic-internal-secret' },
      now: () => {
        throw new Error('synthetic clock failure');
      },
    });
    expect(reader.read({ token: normalIssued.value, binding })).toEqual(invalidToken());
  });

  it('rejects duplicate keys and every invalid TTL configuration boundary', () => {
    expect(() =>
      createRunPreparationTokenCodec({
        currentKey: { version: 'key-v1', secret: 'secret' },
        previousKeys: [{ version: 'key-v1', secret: 'old-secret' }],
      })
    ).toThrow('Invalid run preparation token configuration');
    for (const ttlMs of [0, -1, 1.5, 10 * 60 * 1000 + 1]) {
      expect(() =>
        createRunPreparationTokenCodec({
          currentKey: { version: 'key-v1', secret: 'secret' },
          ttlMs,
        })
      ).toThrow('Invalid run preparation token configuration');
    }
  });

  it('supports omitted rotation and TTL configuration on token issuance', () => {
    const tokens = createRunPreparationTokenCodec({
      currentKey: { version: 'key-v1', secret: 'synthetic-internal-secret' },
      now: () => NOW_MS,
    });

    expect(tokens.issue(claims)).toMatchObject({ ok: true });
  });
});

function codec(
  options: {
    now?: () => number;
    version?: string;
    secret?: string;
    previousKeys?: { version: string; secret: string }[];
  } = {}
): RunPreparationTokenCodec {
  return createRunPreparationTokenCodec({
    currentKey: {
      version: options.version ?? 'key-v1',
      secret: options.secret ?? 'synthetic-internal-secret',
    },
    previousKeys: options.previousKeys ?? [],
    now: options.now ?? ((): number => NOW_MS),
    ttlMs: 5 * 60 * 1000,
  });
}

function invalidToken(): {
  ok: false;
  error: { code: 'INVALID_PREPARATION_TOKEN'; message: 'Invalid run preparation token' };
} {
  return {
    ok: false,
    error: { code: 'INVALID_PREPARATION_TOKEN', message: 'Invalid run preparation token' },
  };
}

function encryptEnvelope(envelope: unknown): string {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv(
    'aes-256-gcm',
    deriveRunPreparationTokenKey('synthetic-internal-secret'),
    iv
  );
  cipher.setAAD(
    Buffer.from(
      ['mdp1', 'run_preparation', binding.userId, binding.definitionId].join('\0'),
      'utf8'
    )
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(envelope), 'utf8'),
    cipher.final(),
  ]);
  const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  return `mdp1.key-v1.${encrypted}`;
}
