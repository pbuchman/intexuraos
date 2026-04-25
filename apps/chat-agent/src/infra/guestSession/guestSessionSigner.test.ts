import { describe, it, expect, beforeEach } from 'vitest';
import { createGuestSessionSigner, type GuestSessionSigner } from './guestSessionSigner.js';

const SECRET = 'test-secret-min-32-bytes-ok-padded-padded';

describe('guestSessionSigner', () => {
  let signer: GuestSessionSigner;

  beforeEach(() => {
    signer = createGuestSessionSigner({ secret: SECRET, ttlSeconds: 3600 });
  });

  it('issues a token whose sub verifies round-trip', async () => {
    const { token, sub, expiresAt } = await signer.issue();
    expect(typeof token).toBe('string');
    expect(sub).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const verified = await signer.verify(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.sub).toBe(sub);
    }
  });

  it('rejects a token signed with a different secret', async () => {
    const other = createGuestSessionSigner({
      secret: 'different-secret-32-bytes-padding-padding',
      ttlSeconds: 3600,
    });
    const { token } = await other.issue();
    const result = await signer.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects a malformed token', async () => {
    const result = await signer.verify('not-a-jwt');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty token', async () => {
    const result = await signer.verify('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects an expired token', async () => {
    const shortSigner = createGuestSessionSigner({ secret: SECRET, ttlSeconds: 1 });
    const { token } = await shortSigner.issue();
    // Wait past expiry
    await new Promise((r) => setTimeout(r, 1100));
    const result = await signer.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXPIRED');
    }
  });

  it('produces opaque subs that differ across issues', async () => {
    const a = await signer.issue();
    const b = await signer.issue();
    expect(a.sub).not.toBe(b.sub);
  });
});
