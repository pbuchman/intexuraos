import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from './useApiClient.js';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import type { OpenRouterModelInfo, OpenRouterModelsResponse } from '../services/researchAgentApi.types.js';
import { config } from '../config.js';

interface UseOpenRouterModelsResult {
  models: OpenRouterModelInfo[];
  loading: boolean;
  error: string | null;
  /** Triggers a fresh fetch; also use to retry after an error. */
  refresh: () => Promise<void>;
}

export function useOpenRouterModels(isConfigured: boolean): UseOpenRouterModelsResult {
  const { request } = useApiClient();
  const [models, setModels] = useState<OpenRouterModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchModels = useCallback(async () => {
    if (!isConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const response = await request<OpenRouterModelsResponse>(
        config.ResearchAgentUrl,
        '/research/openrouter/models'
      );
      setModels(response.models);
      fetchedRef.current = true;
    } catch (err) {
      setError(getErrorMessage(err));
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [isConfigured, request]);

  // Reset fetch state when provider becomes unconfigured so re-enabling triggers a fresh fetch
  useEffect(() => {
    if (!isConfigured) {
      fetchedRef.current = false;
    }
  }, [isConfigured]);

  useEffect(() => {
    if (isConfigured && !fetchedRef.current) {
      void fetchModels();
    }
  }, [isConfigured, fetchModels]);

  if (!isConfigured) {
    return { models: [], loading: false, error: null, refresh: fetchModels };
  }

  return { models, loading, error, refresh: fetchModels };
}
