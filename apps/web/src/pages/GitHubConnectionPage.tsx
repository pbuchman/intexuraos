import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import {
  ApiError,
  disconnectGitHub,
  getGitHubConnectionStatus,
  initiateGitHubOAuth,
} from '@/services';
import type { GitHubConnectionStatus } from '@/types';

export function GitHubConnectionPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      const token = await getAccessToken();
      const githubStatus = await getGitHubConnectionStatus(token);
      setStatus(githubStatus);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch status');
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success');
    const oauthError = searchParams.get('oauth_error');

    if (oauthSuccess === 'true') {
      setSuccessMessage('GitHub connected successfully');
      setSearchParams({}, { replace: true });
    } else if (oauthError !== null && oauthError !== '') {
      setError(`OAuth failed: ${oauthError}`);
      setSearchParams({}, { replace: true });
    }

    void fetchStatus();
  }, [fetchStatus, searchParams, setSearchParams]);

  const handleConnect = async (): Promise<void> => {
    setError(null);
    setSuccessMessage(null);

    try {
      setIsConnecting(true);
      const token = await getAccessToken();
      const response = await initiateGitHubOAuth(token);
      window.location.href = response.authorizationUrl;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to initiate OAuth');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setError(null);
    setSuccessMessage(null);

    try {
      setIsDisconnecting(true);
      const token = await getAccessToken();
      await disconnectGitHub(token);
      setSuccessMessage('GitHub disconnected successfully');
      await fetchStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to disconnect');
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">GitHub</h2>
        <p className="text-slate-600 dark:text-slate-300">Connect your GitHub account to allow IntexuraOS to manage pull requests on your behalf</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {error !== null && error !== '' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">{error}</div>
        ) : null}

        {successMessage !== null && successMessage !== '' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
            {successMessage}
          </div>
        ) : null}

        {status?.connected === true ? (
          <Card title="Connected Account" variant="success">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">Status</dt>
                <dd className="font-medium text-green-700 dark:text-green-400">Connected</dd>
              </div>
              {status.username !== undefined ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Account</dt>
                  <dd className="text-slate-900 dark:text-slate-100">{status.username}</dd>
                </div>
              ) : null}
              {status.scopes !== undefined && status.scopes.length > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Permissions</dt>
                  <dd className="text-slate-900 dark:text-slate-100">{status.scopes.length} granted</dd>
                </div>
              ) : null}
              {status.updatedAt !== undefined ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Connected At</dt>
                  <dd className="text-slate-900 dark:text-slate-100">{new Date(status.updatedAt).toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <Button
                variant="danger"
                isLoading={isDisconnecting}
                onClick={() => void handleDisconnect()}
              >
                Disconnect
              </Button>
            </div>
          </Card>
        ) : (
          <Card title="Connect GitHub">
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              Connect your GitHub account to allow IntexuraOS to manage pull requests on your behalf.
            </p>

            <div className="bg-slate-50 rounded-lg p-4 mb-4 dark:bg-slate-700">
              <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">Permissions requested:</h4>
              <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                <li>• Read and write access to your repositories</li>
                <li>• Read your GitHub profile</li>
              </ul>
            </div>

            <Button isLoading={isConnecting} onClick={() => void handleConnect()}>
              Connect with GitHub
            </Button>
          </Card>
        )}
      </div>
    </Layout>
  );
}
