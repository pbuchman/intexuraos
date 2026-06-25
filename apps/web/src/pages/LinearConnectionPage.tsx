import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Layout } from '@/components';
import { useAuth } from '@/context';
import {
  ApiError,
  disconnectLinear,
  getLinearConnection,
  saveLinearConnection,
  validateLinearApiKey,
  getWebhookConfig,
  saveWebhookSecret,
  removeWebhookSecret,
} from '@/services';
import type { LinearConnectionStatus, LinearTeam, LinearWebhookConfig } from '@/types';

type ConnectionState = 'loading' | 'disconnected' | 'connected' | 'configuring';

export function LinearConnectionPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<ConnectionState>('loading');
  const [connection, setConnection] = useState<LinearConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Configuration form state
  const [apiKey, setApiKey] = useState('');
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Webhook config state
  const [webhookConfig, setWebhookConfig] = useState<LinearWebhookConfig | null>(null);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [isSavingWebhook, setIsSavingWebhook] = useState(false);
  const [isRemovingWebhook, setIsRemovingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookSuccess, setWebhookSuccess] = useState<string | null>(null);
  const [isEditingWebhook, setIsEditingWebhook] = useState(false);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessToken();
      const status = await getLinearConnection(token);
      setConnection(status);
      if (status?.connected === true) {
        setState('connected');
        // Fetch webhook config when connected
        try {
          const config = await getWebhookConfig(token);
          setWebhookConfig(config);
        } catch (e) {
          // Webhook config might fail (403 if not set up yet), but don't fail entire page load
          if (!(e instanceof ApiError && e.status === 403)) {
            setWebhookError(e instanceof ApiError ? e.message : 'Failed to fetch webhook configuration');
          }
        }
      } else {
        setState('disconnected');
        setWebhookConfig(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch connection status');
      setState('disconnected');
      setWebhookConfig(null);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleValidateApiKey = async (): Promise<void> => {
    setError(null);
    if (apiKey.trim() === '') {
      setError('Please enter an API key');
      return;
    }

    try {
      setIsValidating(true);
      const token = await getAccessToken();
      const fetchedTeams = await validateLinearApiKey(token, apiKey.trim());
      setTeams(fetchedTeams);

      if (fetchedTeams.length > 0 && fetchedTeams[0] !== undefined) {
        setSelectedTeamId(fetchedTeams[0].id);
      } else {
        setError('No teams found for this API key');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Invalid API key. Please check and try again.');
      setTeams([]);
      setSelectedTeamId('');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (selectedTeamId === '') {
      setError('Please select a team');
      return;
    }

    const selectedTeam = teams.find((t) => t.id === selectedTeamId);
    if (selectedTeam === undefined) return;

    try {
      setIsSaving(true);
      const token = await getAccessToken();
      await saveLinearConnection(token, {
        apiKey: apiKey.trim(),
        teamId: selectedTeam.id,
        teamName: selectedTeam.name,
      });
      setSuccessMessage('Linear connected successfully');
      await fetchStatus();
      setApiKey('');
      setTeams([]);
      setSelectedTeamId('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save connection');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setError(null);
    setSuccessMessage(null);

    try {
      setIsDisconnecting(true);
      const token = await getAccessToken();

      // Clear webhook secret if configured
      if (webhookConfig?.hasWebhookSecret === true) {
        try {
          await removeWebhookSecret(token);
        } catch {
          // Don't fail disconnect if webhook removal fails
        }
      }

      await disconnectLinear(token);
      setSuccessMessage('Linear disconnected successfully');
      setConnection(null);
      setWebhookConfig(null);
      setState('disconnected');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to disconnect');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleStartConfiguring = (): void => {
    setState('configuring');
    setError(null);
    setSuccessMessage(null);
    setApiKey('');
    setTeams([]);
    setSelectedTeamId('');
  };

  const handleCancelConfiguring = (): void => {
    setState(connection?.connected === true ? 'connected' : 'disconnected');
    setApiKey('');
    setTeams([]);
    setSelectedTeamId('');
    setError(null);
  };

  const handleCopyWebhookUrl = async (): Promise<void> => {
    if (webhookConfig?.webhookUrl) {
      try {
        await navigator.clipboard.writeText(webhookConfig.webhookUrl);
        setCopiedToClipboard(true);
        setTimeout(() => {
          setCopiedToClipboard(false);
        }, 2000);
      } catch {
        // Fallback for browsers that don't support clipboard API
        setWebhookError('Failed to copy to clipboard');
      }
    }
  };

  const handleSaveWebhookSecret = async (): Promise<void> => {
    setWebhookError(null);
    setWebhookSuccess(null);

    const secret = webhookSecret.trim();
    if (secret === '') {
      setWebhookError('Please enter a webhook signing secret');
      return;
    }

    try {
      setIsSavingWebhook(true);
      const token = await getAccessToken();
      await saveWebhookSecret(token, secret);
      setWebhookSuccess('Webhook configured successfully');
      setWebhookSecret('');
      setIsEditingWebhook(false);
      try {
        const refreshed = await getWebhookConfig(token);
        setWebhookConfig(refreshed);
      } catch {
        // Save succeeded — don't mask success with a refresh error
        setWebhookConfig((prev) =>
          prev !== null ? { ...prev, hasWebhookSecret: true } : prev
        );
      }
    } catch (e) {
      setWebhookError(e instanceof ApiError ? e.message : 'Failed to save webhook secret');
    } finally {
      setIsSavingWebhook(false);
    }
  };

  const handleRemoveWebhookSecret = async (): Promise<void> => {
    setWebhookError(null);
    setWebhookSuccess(null);

    try {
      setIsRemovingWebhook(true);
      const token = await getAccessToken();
      await removeWebhookSecret(token);
      setWebhookSuccess('Webhook secret removed');
      setIsEditingWebhook(false);
      try {
        const refreshed = await getWebhookConfig(token);
        setWebhookConfig(refreshed);
      } catch {
        // Remove succeeded — optimistically update local state
        setWebhookConfig((prev) =>
          prev !== null ? { ...prev, hasWebhookSecret: false } : prev
        );
      }
    } catch (e) {
      setWebhookError(e instanceof ApiError ? e.message : 'Failed to remove webhook secret');
    } finally {
      setIsRemovingWebhook(false);
    }
  };

  const handleStartEditingWebhook = (): void => {
    setIsEditingWebhook(true);
    setWebhookError(null);
    setWebhookSuccess(null);
    setWebhookSecret('');
  };

  const handleCancelEditingWebhook = (): void => {
    setIsEditingWebhook(false);
    setWebhookSecret('');
    setWebhookError(null);
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
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Linear Connection</h2>
        <p className="text-slate-600 dark:text-slate-300">
          Connect your Linear workspace to create issues from WhatsApp text requests.
        </p>
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

        {state === 'connected' && connection !== null ? (
          <>
            <Card title="Connected Account" variant="success">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">Status</dt>
                <dd className="font-medium text-green-700 dark:text-green-400">Connected</dd>
              </div>
              {connection.teamName !== null ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Team</dt>
                  <dd className="text-slate-900 dark:text-slate-100">{connection.teamName}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">Connected At</dt>
                <dd className="text-slate-900 dark:text-slate-100">
                  {new Date(connection.updatedAt).toLocaleString()}
                </dd>
              </div>
            </dl>

            <div className="mt-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">
                You can now create Linear issues by saying:
              </p>
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                <li className="flex items-start">
                  <span className="mr-2 text-slate-400 dark:text-slate-500">•</span>
                  <span>"Create linear issue for dark mode feature"</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-slate-400 dark:text-slate-500">•</span>
                  <span>"Nowe zadanie w Linear: napraw walidację"</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-slate-400 dark:text-slate-500">•</span>
                  <span>"Add to Linear: fix login button"</span>
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

          <Card title="Real-time Sync">
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Enable near real-time sync with Linear by configuring a webhook. When enabled, issue
                changes in Linear are reflected instantly instead of waiting for periodic sync.
              </p>

              <details className="bg-slate-50 rounded-lg dark:bg-slate-700">
                <summary className="p-4 text-sm font-medium text-slate-900 dark:text-slate-100 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600 rounded-lg">
                  How to set up Linear webhook
                </summary>
                <ol className="px-4 pb-4 text-sm text-slate-600 dark:text-slate-300 space-y-1 list-decimal list-inside">
                  <li>Go to Linear Settings → API → Webhooks</li>
                  <li>Click &quot;New webhook&quot;</li>
                  <li>Set URL to the webhook URL below</li>
                  <li>Select &quot;Issues&quot; under Data changes</li>
                  <li>Copy the signing secret shown</li>
                  <li>Paste the secret in the field below</li>
                </ol>
              </details>

              {webhookConfig !== null && (
                <div className="bg-slate-50 rounded-lg p-4 dark:bg-slate-700">
                  <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
                    Webhook URL
                  </label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      readOnly
                      value={webhookConfig.webhookUrl}
                      className="flex-1 text-xs bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-l border border-r-0 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 overflow-hidden text-ellipsis whitespace-nowrap"
                      onClick={(e) => {
                        e.currentTarget.select();
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCopyWebhookUrl()}
                      className="rounded-l-none border border-l-0 border-slate-300 dark:border-slate-600 whitespace-nowrap"
                    >
                      {copiedToClipboard ? 'Copied!' : 'Copy'}
                    </Button>
                  </div>
                </div>
              )}

              <div>
                {(isEditingWebhook || webhookConfig?.hasWebhookSecret !== true) && (
                  <Input
                    type="password"
                    label="Webhook Signing Secret"
                    placeholder="Enter the signing secret from Linear"
                    value={webhookSecret}
                    onChange={(e) => {
                      setWebhookSecret(e.target.value);
                      if (webhookError !== null) {
                        setWebhookError(null);
                      }
                    }}
                  />
                )}
                <div className="mt-3">
                  {isEditingWebhook || webhookConfig?.hasWebhookSecret !== true ? (
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        isLoading={isSavingWebhook}
                        onClick={() => void handleSaveWebhookSecret()}
                        disabled={webhookSecret.trim() === '' || isSavingWebhook}
                      >
                        Save
                      </Button>
                      {isEditingWebhook && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleCancelEditingWebhook}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleStartEditingWebhook}
                      >
                        Update Secret
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        isLoading={isRemovingWebhook}
                        onClick={() => void handleRemoveWebhookSecret()}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {webhookError !== null && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
                  <p className="text-sm text-red-700 dark:text-red-400">{webhookError}</p>
                </div>
              )}

              {webhookSuccess !== null && (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/30">
                  <p className="text-sm text-green-700 dark:text-green-400">{webhookSuccess}</p>
                </div>
              )}

              {webhookConfig?.hasWebhookSecret === true && !isEditingWebhook && (
                <div className="rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/30">
                  <p className="text-sm text-green-700 dark:text-green-400">
                    <span className="font-medium">✓ Configured:</span> Real-time sync is active
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
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Connect Linear</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Connect your Linear workspace to create issues from WhatsApp text requests.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 mb-4 dark:bg-slate-700">
              <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">How to get your API key:</h4>
              <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-1 list-decimal list-inside">
                <li>
                  Go to{' '}
                  <a
                    href="https://linear.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Settings -&gt; Security & access
                  </a>
                </li>
                <li>Click "New API key"</li>
                <li>Give it a name (e.g., "IntexuraOS")</li>
                <li>Copy the key and paste it below</li>
              </ol>
            </div>

            <Button type="button" onClick={handleStartConfiguring}>
              Connect Linear
            </Button>
          </Card>
        )}

        {state === 'configuring' && (
          <Card title="Connect Linear">
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div>
                <Input
                  type="password"
                  label="API Key"
                  placeholder="lin_api_..."
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setTeams([]);
                    setSelectedTeamId('');
                  }}
                  className="mb-1"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleValidateApiKey()}
                    disabled={isValidating || apiKey.trim() === ''}
                    isLoading={isValidating}
                  >
                    Validate
                  </Button>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Your Personal API key from Linear settings
                </p>
              </div>

              {teams.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Select Team
                  </label>
                  <select
                    value={selectedTeamId}
                    onChange={(e) => {
                      setSelectedTeamId(e.target.value);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.key})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Choose the team where issues will be created
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={teams.length === 0 || selectedTeamId === ''}
                  isLoading={isSaving}
                >
                  Save Connection
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
