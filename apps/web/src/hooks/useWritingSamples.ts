import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listWritingSamples as listSamplesApi,
  createWritingSample as createSampleApi,
  updateWritingSample as updateSampleApi,
  deleteWritingSample as deleteSampleApi,
} from '@/services/hellscriptWritingConfigApi';
import type { WritingCategory, WritingSample } from '@/types';

interface UseWritingSamplesResult {
  samples: WritingSample[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  createSample: (title: string, text: string) => Promise<void>;
  updateSample: (sampleId: string, title: string, text: string) => Promise<void>;
  deleteSample: (sampleId: string) => Promise<void>;
}

export function useWritingSamples(category: WritingCategory): UseWritingSamplesResult {
  const { getAccessToken } = useAuth();
  const [samples, setSamples] = useState<WritingSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSamples = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listSamplesApi(token, category);
      setSamples(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load writing samples'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, category]);

  useEffect(() => {
    void fetchSamples();
  }, [fetchSamples]);

  const createSample = useCallback(
    async (title: string, text: string): Promise<void> => {
      setSaving(true);
      setError(null);

      try {
        const token = await getAccessToken();
        await createSampleApi(token, category, title, text);
        await fetchSamples();
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to create writing sample'));
      } finally {
        setSaving(false);
      }
    },
    [getAccessToken, category, fetchSamples]
  );

  const updateSample = useCallback(
    async (sampleId: string, title: string, text: string): Promise<void> => {
      setSaving(true);
      setError(null);

      try {
        const token = await getAccessToken();
        await updateSampleApi(token, category, sampleId, title, text);
        await fetchSamples();
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to update writing sample'));
      } finally {
        setSaving(false);
      }
    },
    [getAccessToken, category, fetchSamples]
  );

  const deleteSample = useCallback(
    async (sampleId: string): Promise<void> => {
      setSaving(true);
      setError(null);

      try {
        const token = await getAccessToken();
        await deleteSampleApi(token, category, sampleId);
        await fetchSamples();
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to delete writing sample'));
      } finally {
        setSaving(false);
      }
    },
    [getAccessToken, category, fetchSamples]
  );

  return {
    samples,
    loading,
    error,
    saving,
    createSample,
    updateSample,
    deleteSample,
  };
}
