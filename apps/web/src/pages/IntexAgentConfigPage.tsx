import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { Layout } from '@/components';
import { useAuth } from '@/context';
import {
  clearIntexAgentPreferences,
  getIntexAgentPreferences,
  saveIntexAgentPreferences,
} from '@/services/intexAgentApi';

const MAX_INSTRUCTIONS_LENGTH = 5000;

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
  const [instructions, setInstructions] = useState('');
  const [originalInstructions, setOriginalInstructions] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const data = await getIntexAgentPreferences(token);
      setInstructions(data.instructions);
      setOriginalInstructions(data.instructions);
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

  const trimmedInstructions = instructions.trim();
  const isDirty = trimmedInstructions !== originalInstructions;
  const isEmpty = trimmedInstructions === '';

  const handleSave = useCallback(async (): Promise<void> => {
    if (isEmpty || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const result = await saveIntexAgentPreferences(token, trimmedInstructions);
      setInstructions(result.instructions);
      setOriginalInstructions(result.instructions);
      setUpdatedAt(result.updatedAt);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  }, [getAccessToken, isEmpty, saving, trimmedInstructions]);

  const handleClear = useCallback(async (): Promise<void> => {
    if (clearing) {
      return;
    }
    if (
      !window.confirm(
        'Clear INTEX Agent instructions? The agent will no longer use your personal preferences.'
      )
    ) {
      return;
    }
    setClearing(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const result = await clearIntexAgentPreferences(token);
      setInstructions(result.instructions);
      setOriginalInstructions(result.instructions);
      setUpdatedAt(result.updatedAt);
      setSavedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear preferences');
    } finally {
      setClearing(false);
    }
  }, [clearing, getAccessToken]);

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          INTEX Agent Configuration
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Personal instructions for the INTEX Agent. These are injected into every prompt the agent
          runs, so the agent can adapt to your preferences (e.g. always invite Monika to calendar
          events).
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
          <label
            htmlFor="intex-agent-instructions"
            className="mb-2 block text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Personal instructions
          </label>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Plain-text preferences. The agent follows them as guidance — they never override the
            agent&apos;s built-in rules.
          </p>
          <textarea
            id="intex-agent-instructions"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500"
            rows={8}
            maxLength={MAX_INSTRUCTIONS_LENGTH}
            placeholder="When I add an event to the calendar with Monika, also invite monikamaupa@gmail.com."
            value={instructions}
            onChange={(e): void => {
              setInstructions(e.target.value);
            }}
          />
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
            <span>
              Last updated: <span className="font-medium">{formatUpdatedAt(updatedAt)}</span>
            </span>
            <span>
              {String(instructions.length)}/{String(MAX_INSTRUCTIONS_LENGTH)}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saving || isEmpty || !isDirty}
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
              disabled={clearing || originalInstructions === ''}
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