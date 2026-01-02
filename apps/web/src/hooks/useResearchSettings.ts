import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  getResearchSettings,
  updateResearchSettings,
  type ResearchSettings,
  type SearchMode,
} from '@/services/researchSettingsApi';

interface UseResearchSettingsResult {
  settings: ResearchSettings | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  setSearchMode: (mode: SearchMode) => Promise<void>;
}

export function useResearchSettings(): UseResearchSettingsResult {
  const { user, getAccessToken } = useAuth();
  const [settings, setSettings] = useState<ResearchSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const userId = user?.sub;
    if (userId === undefined) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await getResearchSettings(token, userId);
      setSettings(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load research settings'));
    } finally {
      setLoading(false);
    }
  }, [user?.sub, getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSearchMode = useCallback(
    async (mode: SearchMode): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      setSaving(true);
      setError(null);

      try {
        const token = await getAccessToken();
        const updated = await updateResearchSettings(token, userId, { searchMode: mode });
        setSettings(updated);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to save research settings'));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [user?.sub, getAccessToken]
  );

  return { settings, loading, error, saving, setSearchMode };
}
