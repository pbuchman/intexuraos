import { useEffect, useRef } from 'react';
import Auth0Lock from 'auth0-lock';
import { config } from '@/config';

interface Auth0LockInstance {
  show(): void;
  hide(): void;
  on(event: string, callback: () => void): void;
}

export function Auth0LockWidget(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<Auth0LockInstance | null>(null);

  useEffect(() => {
    if (lockRef.current !== null) return;

    const lock = new Auth0Lock(config.auth0ClientId, config.auth0Domain, {
      container: 'auth0-lock-container',
      auth: {
        redirect: false,
        responseType: 'token id_token',
        audience: config.authAudience,
        params: {
          scope: 'openid profile email',
        },
      },
      autoclose: true,
      closable: false,
      languageDictionary: {
        title: '',
      },
      theme: {
        logo: '',
        primaryColor: '#06b6d4',
        authButtons: {
          'google-oauth2': {
            displayName: 'Google',
            primaryColor: '#4285F4',
            foregroundColor: '#fff',
          },
        },
      },
      allowedConnections: ['google-oauth2'],
      initialScreen: 'login',
      rememberLastLogin: true,
    });

    lock.on('authenticated', () => {
      window.location.href = `${window.location.origin}/#/inbox`;
    });

    lock.on('authorization_error', () => {
      // Auth0 Lock displays errors in its UI
    });

    lockRef.current = lock;
    lock.show();

    return (): void => {
      lock.hide();
      lockRef.current = null;
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-600 to-blue-800">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold">
            <span className="text-cyan-400">Intexura</span>
            <span className="text-white">OS</span>
          </h1>
          <p className="mt-2 text-blue-100">Personal Operating System</p>
        </div>
        <div
          id="auth0-lock-container"
          ref={containerRef}
          className="rounded-2xl bg-white shadow-xl overflow-hidden"
        />
      </div>
    </div>
  );
}
