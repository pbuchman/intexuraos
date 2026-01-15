import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Layout } from '@/components';
import { useAuth } from '@/context';
import { ApiError, disconnectLinear, getLinearConnection, saveLinearConnection, validateLinearApiKey } from '@/services';
import type { LinearConnectionStatus, LinearTeam } from '@/types';

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

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessToken();
      const status = await getLinearConnection(token);
      setConnection(status);
      if (status?.connected === true) {
        setState('connected');
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
      await disconnectLinear(token);
      setSuccessMessage('Linear disconnected successfully');
      setConnection(null);
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
        <h2 className="text-2xl font-bold text-slate-900">Linear Connection</h2>
        <p className="text-slate-600">
          Connect your Linear workspace to create issues via voice commands.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {error !== null && error !== '' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
        ) : null}

        {successMessage !== null && successMessage !== '' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
            {successMessage}
          </div>
        ) : null}

        {state === 'connected' && connection !== null ? (
          <Card title="Connected Account" variant="success">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Status</dt>
                <dd className="font-medium text-green-700">Connected</dd>
              </div>
              {connection.teamName !== null ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Team</dt>
                  <dd className="text-slate-900">{connection.teamName}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-slate-600">Connected At</dt>
                <dd className="text-slate-900">{new Date(connection.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>

            <div className="mt-4 rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-600 mb-2">You can now create Linear issues by saying:</p>
              <ul className="space-y-1 text-sm text-slate-700">
                <li className="flex items-start">
                  <span className="mr-2 text-slate-400">•</span>
                  <span>"Create linear issue for dark mode feature"</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-slate-400">•</span>
                  <span>"Nowe zadanie w Linear: napraw walidację"</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2 text-slate-400">•</span>
                  <span>"Add to Linear: fix login button"</span>
                </li>
              </ul>
            </div>

            <div className="mt-4 flex gap-3 border-t border-slate-200 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={handleStartConfiguring}
              >
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
        ) : null}

        {state === 'disconnected' && (
          <Card title="Not Connected">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-400" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Connect Linear</h3>
                <p className="text-sm text-slate-500">
                  Connect your Linear workspace to create issues via voice commands.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 mb-4">
              <h4 className="text-sm font-medium text-slate-900 mb-2">
                How to get your API key:
              </h4>
              <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
                <li>Go to{' '}
                  <a
                    href="https://linear.app/settings/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    linear.app/settings/api
                  </a>
                </li>
                <li>Click "Create new API key"</li>
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
                <p className="mt-1 text-xs text-slate-500">
                  Your Personal API key from Linear settings
                </p>
              </div>

              {teams.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Select Team
                  </label>
                  <select
                    value={selectedTeamId}
                    onChange={(e) => {
                      setSelectedTeamId(e.target.value);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.key})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleCancelConfiguring}
                >
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
