import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Layout } from '@/components';
import { useAuth } from '@/context';
import {
  ApiError,
  connectNotion,
  disconnectNotion,
  getNotionStatus,
  getResearchNotionSettings,
  saveResearchNotionSettings,
  validateResearchNotionPage,
} from '@/services';
import type { NotionStatus } from '@/types';

type ConnectionState = 'loading' | 'disconnected' | 'connected' | 'configuring';

type ValidationState = 'idle' | 'validating' | 'valid' | 'error';

export function NotionConnectionPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<ConnectionState>('loading');
  const [connection, setConnection] = useState<NotionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [notionToken, setNotionToken] = useState('');
  const [researchPageId, setResearchPageId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSavingResearch, setIsSavingResearch] = useState(false);

  // Validation state
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [validatedPage, setValidatedPage] = useState<{ title: string; url: string } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessToken();
      const status = await getNotionStatus(token);
      setConnection(status);

      if (status.connected) {
        setState('connected');
        // Fetch research settings
        try {
          const researchSettings = await getResearchNotionSettings(token);
          setResearchPageId(researchSettings.researchPageId ?? '');
          if (researchSettings.researchPageId && researchSettings.researchPageTitle) {
            setValidatedPage({
              title: researchSettings.researchPageTitle,
              url: researchSettings.researchPageUrl ?? '',
            });
            setValidationState('valid');
          }
        } catch (e) {
          // 404 = research settings not configured yet (expected for new users)
          // Other errors (network, 5xx) are not shown to avoid confusing users on initial load,
          // but will surface when they try to validate/save
          if (!(e instanceof ApiError && e.status === 404)) {
            setValidationError('Could not load existing research settings');
          }
        }
      } else {
        setState('disconnected');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch connection status');
      setState('disconnected');
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleConnect = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (notionToken.trim() === '') {
      setError('Please enter an integration token');
      return;
    }

    try {
      setIsConnecting(true);
      const token = await getAccessToken();
      await connectNotion(token, { notionToken: notionToken.trim() });
      setSuccessMessage('Notion connected successfully');
      setNotionToken('');
      await fetchStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to connect. Please check your token and try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setError(null);
    setSuccessMessage(null);

    try {
      setIsDisconnecting(true);
      const token = await getAccessToken();
      await disconnectNotion(token);
      setSuccessMessage('Notion disconnected successfully');
      setConnection(null);
      setResearchPageId('');
      setState('disconnected');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to disconnect');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSaveResearchPage = async (): Promise<void> => {
    setError(null);
    setValidationError(null);
    setSuccessMessage(null);

    const pageId = researchPageId.trim();
    if (pageId === '') {
      setValidationError('Please enter a Page ID');
      return;
    }

    try {
      setValidationState('validating');
      setIsSavingResearch(true);
      const token = await getAccessToken();

      // Validate the page
      const result = await validateResearchNotionPage(token, pageId);
      const validated = { title: result.title, url: result.url };

      // Save the settings
      await saveResearchNotionSettings(token, pageId, validated.title, validated.url);

      setValidatedPage(validated);
      setValidationState('valid');
    } catch (e) {
      setValidationState('error');
      setValidationError(e instanceof ApiError ? e.message : 'Failed to save research settings');
    } finally {
      setIsSavingResearch(false);
    }
  };

  const handleStartConfiguring = (): void => {
    setState('configuring');
    setError(null);
    setSuccessMessage(null);
    setNotionToken('');
  };

  const handleCancelConfiguring = (): void => {
    setState(connection?.connected === true ? 'connected' : 'disconnected');
    setNotionToken('');
    setError(null);
  };

  if (state === 'loading') {
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
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Notion Connection</h2>
        <p className="text-slate-600 dark:text-slate-300">
          Connect your Notion workspace to export research and sync prompts.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {state !== 'connected' && error !== null && error !== '' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">{error}</div>
        ) : null}

        {state !== 'connected' && successMessage !== null && successMessage !== '' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
            {successMessage}
          </div>
        ) : null}

        {state === 'connected' && connection !== null ? (
          <>
            <Card title="Connected Account" variant="success">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Status</dt>
                  <dd className="font-medium text-green-700 dark:text-green-400">Connected</dd>
                </div>
                {connection.updatedAt !== null ? (
                  <div className="flex justify-between">
                    <dt className="text-slate-600 dark:text-slate-400">Connected At</dt>
                    <dd className="text-slate-900 dark:text-slate-100">
                      {new Date(connection.updatedAt).toLocaleString()}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div className="mt-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">
                  With Notion connected, you can:
                </p>
                <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                  <li className="flex items-start">
                    <span className="mr-2 text-slate-400 dark:text-slate-500">•</span>
                    <span>Export completed research to Notion pages</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2 text-slate-400 dark:text-slate-500">•</span>
                    <span>Auto-export research when synthesis completes</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2 text-slate-400 dark:text-slate-500">•</span>
                    <span>Sync prompts from Notion databases</span>
                  </li>
                </ul>
              </div>

              <div className="mt-4 flex gap-3 border-t border-slate-200 dark:border-slate-700 pt-4">
                <Button type="button" variant="secondary" onClick={handleStartConfiguring}>
                  Reconfigure
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  isLoading={isDisconnecting}
                  onClick={() => void handleDisconnect()}
                >
                  Disconnect
                </Button>
              </div>
            </Card>

            {error !== null && error !== '' ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">{error}</div>
            ) : null}

            {successMessage !== null && successMessage !== '' ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
                {successMessage}
              </div>
            ) : null}

            <Card title="Research Export Settings">
              <div className="space-y-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Configure a Notion page where completed research will be exported.
                </p>

                <details className="bg-slate-50 rounded-lg dark:bg-slate-700">
                  <summary className="p-4 text-sm font-medium text-slate-900 dark:text-slate-100 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600 rounded-lg">
                    How to get the Page ID
                  </summary>
                  <ol className="px-4 pb-4 text-sm text-slate-600 dark:text-slate-300 space-y-1 list-decimal list-inside">
                    <li>Open the target page in Notion</li>
                    <li>Click "Share" → "Copy link"</li>
                    <li>The ID is the 32-character string after the page name</li>
                    <li>Example: notion.so/My-Page-<span className="font-mono text-xs">abc123def456...</span></li>
                  </ol>
                </details>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 dark:bg-amber-900/30 dark:border-amber-800">
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    <span className="font-medium">Important:</span> Make sure the page is shared with
                    your IntexuraOS integration in Notion (click "..." → "Add connections").
                  </p>
                </div>

                <div>
                  <Input
                    label="Research Export Page ID"
                    placeholder="Enter your Notion page ID (32 characters or UUID format)"
                    value={researchPageId}
                    onChange={(e) => {
                      setResearchPageId(e.target.value);
                      if (validationState === 'error') {
                        setValidationState('idle');
                        setValidationError(null);
                      }
                    }}
                  />
                  <div className="mt-3">
                    <Button
                      type="button"
                      isLoading={isSavingResearch}
                      onClick={() => void handleSaveResearchPage()}
                      disabled={researchPageId.trim() === '' || isSavingResearch}
                    >
                      Save
                    </Button>
                  </div>
                </div>

                {validationState === 'error' && validationError !== null && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
                    <p className="text-sm text-red-700 dark:text-red-400">{validationError}</p>
                  </div>
                )}

                {validationState === 'valid' && validatedPage !== null && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/30">
                    <p className="text-sm text-green-700 dark:text-green-400">
                      <span className="font-medium">✓ Configured:</span> Research exports will be sent to{' '}
                      <a
                        href={validatedPage.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {validatedPage.title}
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </>
        ) : null}

        {state === 'disconnected' && (
          <Card title="Not Connected">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-400 dark:border-slate-500" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Connect Notion</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Connect your Notion workspace to export research and sync prompts.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 mb-4 dark:bg-slate-700">
              <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">How to get your integration token:</h4>
              <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-1 list-decimal list-inside">
                <li>
                  Go to{' '}
                  <a
                    href="https://www.notion.so/my-integrations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    notion.so/my-integrations
                  </a>
                </li>
                <li>Click "New integration"</li>
                <li>Give it a name (e.g., "IntexuraOS")</li>
                <li>Select your workspace</li>
                <li>Copy the "Internal Integration Secret"</li>
                <li>
                  <span className="font-medium">Important:</span> Share your target pages with the integration
                </li>
              </ol>
            </div>

            <Button type="button" onClick={handleStartConfiguring}>
              Connect Notion
            </Button>
          </Card>
        )}

        {state === 'configuring' && (
          <Card title="Connect Notion">
            <form onSubmit={(e) => void handleConnect(e)} className="space-y-4">
              <div>
                <Input
                  type="password"
                  label="Integration Token"
                  placeholder="secret_..."
                  value={notionToken}
                  onChange={(e) => {
                    setNotionToken(e.target.value);
                  }}
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Your Internal Integration Secret from Notion
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 dark:bg-amber-900/30 dark:border-amber-800">
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  <span className="font-medium">Remember:</span> After connecting, you must share
                  your Notion pages with this integration for IntexuraOS to access them.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" isLoading={isConnecting}>
                  Connect
                </Button>
                <Button type="button" variant="ghost" onClick={handleCancelConfiguring}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </Layout>
  );
}
