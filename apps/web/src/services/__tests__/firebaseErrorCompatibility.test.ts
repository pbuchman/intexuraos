import { FirebaseError } from 'firebase/app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureFirebaseErrorNameCompatibility } from '../firebaseErrorCompatibility.js';

const originalErrorNameDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name');
const patchedFirebaseErrorPrototypes = new Set<object>([FirebaseError.prototype]);

if (originalErrorNameDescriptor === undefined) {
  throw new Error('Error.prototype.name descriptor is unavailable');
}

afterEach(() => {
  Object.defineProperty(Error.prototype, 'name', originalErrorNameDescriptor);
  for (const prototype of patchedFirebaseErrorPrototypes) {
    Reflect.deleteProperty(prototype, 'name');
  }
  patchedFirebaseErrorPrototypes.clear();
  patchedFirebaseErrorPrototypes.add(FirebaseError.prototype);
  vi.doUnmock('@/config');
  vi.doUnmock('../../App.js');
  vi.doUnmock('../../config.js');
  vi.doUnmock('@sentry/react');
  vi.doUnmock('react-dom/client');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('ensureFirebaseErrorNameCompatibility', () => {
  it('allows FirebaseError construction when Error.prototype.name is read-only', () => {
    Object.defineProperty(Error.prototype, 'name', {
      ...originalErrorNameDescriptor,
      writable: false,
    });

    ensureFirebaseErrorNameCompatibility();

    expect(new FirebaseError('cancelled', 'Operation cancelled')).toMatchObject({
      code: 'cancelled',
      message: 'Operation cancelled',
      name: 'FirebaseError',
    });
  });

  it('installs the compatibility guard when the Firebase service loads', async () => {
    vi.resetModules();
    vi.doMock('@/config', () => ({ config: {} }));
    Object.defineProperty(Error.prototype, 'name', {
      ...originalErrorNameDescriptor,
      writable: false,
    });

    const { FirebaseError: IsolatedFirebaseError } = await import('firebase/app');
    patchedFirebaseErrorPrototypes.add(IsolatedFirebaseError.prototype);
    await import('../firebase.js');

    expect(new IsolatedFirebaseError('cancelled', 'Operation cancelled').name).toBe('FirebaseError');
  });

  it('installs the compatibility guard before the application module graph loads', async () => {
    vi.resetModules();
    let appGraphFirebaseErrorName: string | undefined;

    vi.doMock('../../App.js', async () => {
      const { FirebaseError: AppGraphFirebaseError } = await import('firebase/app');
      patchedFirebaseErrorPrototypes.add(AppGraphFirebaseError.prototype);
      appGraphFirebaseErrorName = new AppGraphFirebaseError(
        'cancelled',
        'Operation cancelled',
      ).name;

      return { App: (): null => null };
    });
    vi.doMock('@/config', () => ({ config: { sentryDsn: '' } }));
    vi.doMock('../../config.js', () => ({ config: { sentryDsn: '' } }));
    vi.doMock('@sentry/react', () => ({ init: vi.fn() }));
    vi.doMock('react-dom/client', () => ({
      createRoot: (): { render: () => void } => ({ render: vi.fn() }),
    }));
    vi.stubGlobal('document', { getElementById: (): object => ({}) });
    Object.defineProperty(Error.prototype, 'name', {
      ...originalErrorNameDescriptor,
      writable: false,
    });

    await import('../../index.js');

    expect(appGraphFirebaseErrorName).toBe('FirebaseError');
  });
});
