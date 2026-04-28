/**
 * Tests for the Firestore health check helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firestoreHealthCheck } from '../health.js';

vi.mock('@intexuraos/common-core', () => ({
  getErrorMessage: vi.fn((error: unknown) =>
    // eslint-disable-next-line no-restricted-syntax -- Mocking getErrorMessage itself
    error instanceof Error ? error.message : 'Unknown error'
  ),
}));

vi.mock('../firestore.js', () => ({
  getFirestore: vi.fn(),
}));

describe('firestoreHealthCheck', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  it('returns a probe named "firestore"', () => {
    const probe = firestoreHealthCheck();
    expect(probe.name).toBe('firestore');
  });

  it('returns ok in test environment (NODE_ENV=test) without touching Firestore', async () => {
    process.env['NODE_ENV'] = 'test';
    const { getFirestore } = await import('../firestore.js');

    const outcome = await firestoreHealthCheck().check();

    expect(outcome).toEqual({ ok: true });
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it('returns ok when VITEST is set without touching Firestore', async () => {
    process.env['VITEST'] = 'true';
    const { getFirestore } = await import('../firestore.js');

    const outcome = await firestoreHealthCheck().check();

    expect(outcome).toEqual({ ok: true });
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it('returns ok when Firestore check succeeds in production mode', async () => {
    delete process.env['VITEST'];
    process.env['NODE_ENV'] = 'production';

    const { getFirestore } = await import('../firestore.js');
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: false }),
        }),
      }),
    };
    vi.mocked(getFirestore).mockReturnValue(mockDb as unknown as ReturnType<typeof getFirestore>);

    const outcome = await firestoreHealthCheck().check();

    expect(outcome).toEqual({ ok: true });
  });

  it('returns ok=false with detail when Firestore client throws', async () => {
    delete process.env['VITEST'];
    process.env['NODE_ENV'] = 'production';

    const { getFirestore } = await import('../firestore.js');
    vi.mocked(getFirestore).mockImplementation(() => {
      throw new Error('Firestore connection failed');
    });

    const outcome = await firestoreHealthCheck().check();

    expect(outcome).toEqual({ ok: false, detail: 'Firestore connection failed' });
  });

  it('returns ok=false with timeout detail when the doc read never resolves', async () => {
    vi.useFakeTimers();
    delete process.env['VITEST'];
    process.env['NODE_ENV'] = 'production';

    const { getFirestore } = await import('../firestore.js');
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(
            // eslint-disable-next-line @typescript-eslint/no-empty-function -- Intentionally never resolves to trigger timeout
            () => new Promise(() => {})
          ),
        }),
      }),
    };
    vi.mocked(getFirestore).mockReturnValue(mockDb as unknown as ReturnType<typeof getFirestore>);

    const outcomePromise = firestoreHealthCheck().check();
    await vi.advanceTimersByTimeAsync(3100);

    const outcome = await outcomePromise;

    expect(outcome).toEqual({ ok: false, detail: 'Firestore health check timed out' });
  });
});
