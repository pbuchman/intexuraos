import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  getHellscriptWorkspace as getWorkspaceApi,
  imposeOnBuffer as imposeApi,
} from '@/services/hellscriptAgentApi';
import type { HellscriptWorkspaceResponse } from '@/types';

interface UseHellscriptWorkspaceResult {
  workspace: HellscriptWorkspaceResponse | null;
  loading: boolean;
  error: string | null;
  impose: (utterance: string) => Promise<void>;
  imposing: boolean;
  lastAction: string | null;
  clearLastAction: () => void;
}

export function useHellscriptWorkspace(
  bufferId: string | undefined // @allow-undefined-type -- function parameter, not optional property
): UseHellscriptWorkspaceResult {
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<HellscriptWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(bufferId !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [imposing, setImposing] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const fetchWorkspace = useCallback(
    async (id: string): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const token = await getAccessToken();
        const data = await getWorkspaceApi(token, id);
        setWorkspace(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load workspace'));
      } finally {
        setLoading(false);
      }
    },
    [getAccessToken]
  );

  useEffect(() => {
    if (bufferId !== undefined) {
      void fetchWorkspace(bufferId);
    }
  }, [bufferId, fetchWorkspace]);

  const impose = useCallback(
    async (utterance: string): Promise<void> => {
      setImposing(true);
      setError(null);

      try {
        const token = await getAccessToken();
        const request = bufferId !== undefined
          ? { bufferId, utterance }
          : { utterance };
        const response = await imposeApi(token, request);
        setLastAction(response.action);

        // For new conversations, navigate to the created buffer
        if (bufferId === undefined) {
          void navigate(`/hellscript/${response.bufferId}`, { replace: true });
        } else {
          // Re-fetch workspace to get updated events/drafts
          await fetchWorkspace(bufferId);
        }
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to impose on buffer'));
      } finally {
        setImposing(false);
      }
    },
    [getAccessToken, bufferId, navigate, fetchWorkspace]
  );

  const clearLastAction = useCallback(() => {
    setLastAction(null);
  }, []);

  return {
    workspace,
    loading,
    error,
    impose,
    imposing,
    lastAction,
    clearLastAction,
  };
}
