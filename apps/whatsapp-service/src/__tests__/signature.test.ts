/**
 * Tests for signature validation utility.
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

describe('signature validation', () => {
  it('validates correct signature', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const secret = 'test-secret';
    const hash = createHmac('sha256', secret).update(payload).digest('hex');
    const signature = `sha256=${hash}`;

    expect(validateWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects invalid signature', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const secret = 'test-secret';

    expect(validateWebhookSignature(payload, 'sha256=invalid', secret)).toBe(false);
  });

  it('rejects signature without sha256= prefix', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const secret = 'test-secret';
    const hash = createHmac('sha256', secret).update(payload).digest('hex');

    expect(validateWebhookSignature(payload, hash, secret)).toBe(false);
  });

  it('rejects signature with different secret', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const hash = createHmac('sha256', 'secret1').update(payload).digest('hex');
    const signature = `sha256=${hash}`;

    expect(validateWebhookSignature(payload, signature, 'secret2')).toBe(false);
  });

  it('rejects signature with modified payload', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const secret = 'test-secret';
    const hash = createHmac('sha256', secret).update('original payload').digest('hex');
    const signature = `sha256=${hash}`;

    expect(validateWebhookSignature('modified payload', signature, secret)).toBe(false);
  });

  it('rejects signature with invalid hex characters', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const secret = 'test-secret';

    // 'xyz' is not valid hex
    expect(validateWebhookSignature(payload, 'sha256=xyz', secret)).toBe(false);
  });

  it('rejects signature with wrong length', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const secret = 'test-secret';

    // Valid hex but wrong length (too short)
    expect(validateWebhookSignature(payload, 'sha256=abc123', secret)).toBe(false);
  });
});
