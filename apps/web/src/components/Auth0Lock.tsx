import { useEffect, useRef } from 'react';
import Auth0Lock from 'auth0-lock';
import { config } from '@/config';

interface AuthResult {
  accessToken: string;
  idToken: string;
  idTokenPayload: Record<string, unknown>;
  refreshToken?: string;
  state?: string;
}

interface Auth0LockInstance {
  show(): void;
  hide(): void;
  on(event: 'authenticated', callback: (authResult: AuthResult) => void): void;
  on(event: 'authorization_error', callback: (error: Error) => void): void;
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

    lock.on('authenticated', (authResult) => {
      // Store tokens in localStorage for auth0-react SDK to pick up
      // The SDK expects tokens in a specific cache format
      const cacheKey = `@@auth0spajs@@::${config.auth0ClientId}::${config.authAudience}::openid profile email`;
      const cacheEntry = {
        body: {
          access_token: authResult.accessToken,
          id_token: authResult.idToken,
          scope: 'openid profile email',
          expires_in: 86400,
          token_type: 'Bearer',
        },
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      };
      localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));

      // Redirect to let auth0-react pick up the session
      window.location.href = `${window.location.origin}/#/inbox`;
    });

    lock.on('authorization_error', (_error) => {
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
