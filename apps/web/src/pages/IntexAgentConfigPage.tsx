import { useCallback, useEffect, useState } from 'react';
import { Loader2, PlugZap, Save, Trash2 } from 'lucide-react';
import { Layout } from '@/components';
import { useAuth } from '@/context';
import {
  clearIntexAgentPreferences,
  getIntexAgentPreferences,
  saveIntexAgentPreferences,
  testIntexAgentExternalSave,
  type IntexAgentExternalSaveConfig,
} from '@/services/intexAgentApi';

const DEFAULT_EXTERNAL_SAVE: IntexAgentExternalSaveConfig = {
  enabled: false,
  endpointUrl: '',
  cfAccessClientId: '',
  cfAccessClientSecret: '',
  source: 'ios-shortcuts',
};

function formatUpdatedAt(updatedAt: string | null): string {
  if (updatedAt === null) {
    return 'Never saved';
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return updatedAt;
  }
  return date.toLocaleString();
}

export function IntexAgentConfigPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [externalSave, setExternalSave] = useState<IntexAgentExternalSaveConfig>(DEFAULT_EXTERNAL_SAVE);
  const [originalExternalSave, setOriginalExternalSave] =
    useState<IntexAgentExternalSaveConfig>(DEFAULT_EXTERNAL_SAVE);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const data = await getIntexAgentPreferences(token);
      setExternalSave(data.externalSave);
      setOriginalExternalSave(data.externalSave);
      setUpdatedAt(data.updatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isDirty = JSON.stringify(externalSave) !== JSON.stringify(originalExternalSave);
  const externalSaveReady =
    !externalSave.enabled ||
    (
      externalSave.endpointUrl.trim() !== '' &&
      externalSave.cfAccessClientId.trim() !== '' &&
      externalSave.cfAccessClientSecret.trim() !== '' &&
      externalSave.source.trim() !== ''
    );
  const canSave = isDirty && externalSaveReady && !saving;

  const handleSave = useCallback(async (): Promise<void> => {
    if (!canSave) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const result = await saveIntexAgentPreferences(token, {
        instructions: '',
        externalSave: normalizeExternalSave(externalSave),
      });
      setExternalSave(result.externalSave);
      setOriginalExternalSave(result.externalSave);
      setUpdatedAt(result.updatedAt);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  }, [canSave, externalSave, getAccessToken]);

  const handleClear = useCallback(async (): Promise<void> => {
    if (clearing) {
      return;
    }
    if (
      !window.confirm('Clear Intex Agent external save configuration?')
    ) {
      return;
    }
    setClearing(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const result = await clearIntexAgentPreferences(token);
      setExternalSave(result.externalSave);
      setOriginalExternalSave(result.externalSave);
      setUpdatedAt(result.updatedAt);
      setSavedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear preferences');
    } finally {
      setClearing(false);
    }
  }, [clearing, getAccessToken]);

  const handleExternalSaveChange = useCallback(
    <K extends keyof IntexAgentExternalSaveConfig>(
      key: K,
      value: IntexAgentExternalSaveConfig[K]
    ): void => {
      setExternalSave((current) => ({ ...current, [key]: value }));
      setTestMessage(null);
    },
    []
  );

  const handleTestConnection = useCallback(async (): Promise<void> => {
    if (testing || !externalSave.enabled || !externalSaveReady) {
      return;
    }
    setTesting(true);
    setError(null);
    setTestMessage(null);
    try {
      const token = await getAccessToken();
      const result = await testIntexAgentExternalSave(token, normalizeExternalSave(externalSave));
      setTestMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test external save');
    } finally {
      setTesting(false);
    }
  }, [externalSave, externalSaveReady, getAccessToken, testing]);

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Intex Agent External Save
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configure the protected endpoint used for explicit external-save requests and WhatsApp
          images. Prompt preferences are managed from Intex Agent Preferences.
        </p>
      </div>

      {error !== null ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            Last updated: <span className="font-medium">{formatUpdatedAt(updatedAt)}</span>
          </div>

          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  External Save
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Cloudflare Access protected endpoint used by Intex when images or explicit
                  external-save requests arrive.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={externalSave.enabled}
                  onChange={(event): void => {
                    handleExternalSaveChange('enabled', event.target.checked);
                  }}
                />
                Enable external save
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Endpoint URL
                <input
                  type="url"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  value={externalSave.endpointUrl}
                  onChange={(event): void => {
                    handleExternalSaveChange('endpointUrl', event.target.value);
                  }}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Source label
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  value={externalSave.source}
                  onChange={(event): void => {
                    handleExternalSaveChange('source', event.target.value);
                  }}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Cloudflare Access client ID
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  value={externalSave.cfAccessClientId}
                  onChange={(event): void => {
                    handleExternalSaveChange('cfAccessClientId', event.target.value);
                  }}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Cloudflare Access client secret
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  value={externalSave.cfAccessClientSecret}
                  onChange={(event): void => {
                    handleExternalSaveChange('cfAccessClientSecret', event.target.value);
                  }}
                />
              </label>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                disabled={testing || !externalSave.enabled || !externalSaveReady}
                onClick={(): void => {
                  void handleTestConnection();
                }}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="h-4 w-4" />
                )}
                Test connection
              </button>
              {testMessage !== null ? (
                <span className="text-xs text-green-600 dark:text-green-400">{testMessage}</span>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSave}
              onClick={(): void => {
                void handleSave();
              }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              disabled={clearing || updatedAt === null}
              onClick={(): void => {
                void handleClear();
              }}
            >
              {clearing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Clear
            </button>
            {savedAt !== null ? (
              <span className="text-xs text-green-600 dark:text-green-400">Saved.</span>
            ) : null}
          </div>
        </div>
      )}
    </Layout>
  );
}

function normalizeExternalSave(
  externalSave: IntexAgentExternalSaveConfig
): IntexAgentExternalSaveConfig {
  return {
    enabled: externalSave.enabled,
    endpointUrl: externalSave.endpointUrl.trim(),
    cfAccessClientId: externalSave.cfAccessClientId.trim(),
    cfAccessClientSecret: externalSave.cfAccessClientSecret.trim(),
    source: externalSave.source.trim() === '' ? 'ios-shortcuts' : externalSave.source.trim(),
  };
}
