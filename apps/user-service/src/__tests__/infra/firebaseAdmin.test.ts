/**
 * Tests for Firebase Admin SDK initialization
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getApps: vi.fn(() => []),
}));

describe('Firebase Admin', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project-id';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env['GOOGLE_CLOUD_PROJECT'];
  });

  describe('getFirebaseAdmin', () => {
    it('initializes Firebase app with project ID from environment', async () => {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      vi.mocked(getApps).mockReturnValue([]);

      const { getFirebaseAdmin, resetFirebaseAdmin } =
        await import('../../infra/firebase/admin.js');

      const app = getFirebaseAdmin();

      expect(initializeApp).toHaveBeenCalledWith({ projectId: 'test-project-id' });
      expect(app).toEqual({ name: '[DEFAULT]' });

      resetFirebaseAdmin();
    });

    it('returns existing app if already initialized', async () => {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      vi.mocked(getApps).mockReturnValue([]);

      const { getFirebaseAdmin, resetFirebaseAdmin } =
        await import('../../infra/firebase/admin.js');

      const app1 = getFirebaseAdmin();
      const app2 = getFirebaseAdmin();

      expect(app1).toBe(app2);
      expect(initializeApp).toHaveBeenCalledTimes(1);

      resetFirebaseAdmin();
    });

    it('uses existing Firebase app if available', async () => {
      const existingApp = { name: 'existing-app' };
      const { initializeApp, getApps } = await import('firebase-admin/app');
      vi.mocked(getApps).mockReturnValue([existingApp as ReturnType<typeof getApps>[number]]);

      const { getFirebaseAdmin, resetFirebaseAdmin } =
        await import('../../infra/firebase/admin.js');

      resetFirebaseAdmin();

      const app = getFirebaseAdmin();

      expect(app).toEqual(existingApp);
      expect(initializeApp).not.toHaveBeenCalled();

      resetFirebaseAdmin();
    });

    it('throws error if GOOGLE_CLOUD_PROJECT is not set', async () => {
      delete process.env['GOOGLE_CLOUD_PROJECT'];

      const { getApps } = await import('firebase-admin/app');
      vi.mocked(getApps).mockReturnValue([]);

      const { getFirebaseAdmin, resetFirebaseAdmin } =
        await import('../../infra/firebase/admin.js');

      resetFirebaseAdmin();

      expect(() => getFirebaseAdmin()).toThrow('Missing GOOGLE_CLOUD_PROJECT environment variable');
    });

    it('throws error if GOOGLE_CLOUD_PROJECT is empty string', async () => {
      process.env['GOOGLE_CLOUD_PROJECT'] = '';

      const { getApps } = await import('firebase-admin/app');
      vi.mocked(getApps).mockReturnValue([]);

      const { getFirebaseAdmin, resetFirebaseAdmin } =
        await import('../../infra/firebase/admin.js');

      resetFirebaseAdmin();

      expect(() => getFirebaseAdmin()).toThrow('Missing GOOGLE_CLOUD_PROJECT environment variable');
    });
  });

  describe('resetFirebaseAdmin', () => {
    it('clears the cached Firebase app', async () => {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      vi.mocked(getApps).mockReturnValue([]);

      const { getFirebaseAdmin, resetFirebaseAdmin } =
        await import('../../infra/firebase/admin.js');

      getFirebaseAdmin();
      resetFirebaseAdmin();
      getFirebaseAdmin();

      expect(initializeApp).toHaveBeenCalledTimes(2);

      resetFirebaseAdmin();
    });
  });
});
