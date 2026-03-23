import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  getWritingConfig as getConfigApi,
  updateStyleInstructions as updateStyleApi,
  deleteStyleInstructions as deleteStyleApi,
} from '@/services/hellscriptWritingConfigApi';
import type { WritingCategory, WritingStyleConfig } from '@/types';

interface UseWritingConfigResult {
  config: WritingStyleConfig | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  updateStyle: (category: WritingCategory, text: string) => Promise<void>;
  clearStyle: (category: WritingCategory) => Promise<void>;
}

export function useWritingConfig(): UseWritingConfigResult {
  const { getAccessToken } = useAuth();
  const [config, setConfig] = useState<WritingStyleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await getConfigApi(token);
      setConfig(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load writing config'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const updateStyle = useCallback(
    async (category: WritingCategory, text: string): Promise<void> => {
      setSaving(true);
      setError(null);

      try {
        const token = await getAccessToken();
        await updateStyleApi(token, category, text);
        await fetchConfig();
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to save style instructions'));
      } finally {
        setSaving(false);
      }
    },
    [getAccessToken, fetchConfig]
  );

  const clearStyle = useCallback(
    async (category: WritingCategory): Promise<void> => {
      setSaving(true);
      setError(null);

      try {
        const token = await getAccessToken();
        await deleteStyleApi(token, category);
        await fetchConfig();
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to clear style instructions'));
      } finally {
        setSaving(false);
      }
    },
    [getAccessToken, fetchConfig]
  );

  return {
    config,
    loading,
    error,
    saving,
    updateStyle,
    clearStyle,
  };
}
