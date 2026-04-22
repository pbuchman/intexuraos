/**
 * Hook: fetch one digest + its optional state snapshot, plus a regenerate
 * action handler. Mirrors the useTaskView shape (load + error + action).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import {
  getDigest,
  getDigestState,
  runDigest,
} from '@/services/notificationDigestsApi';
import type {
  GroupState,
  PersistedDailySummary,
  RunDigestResponse,
} from '@/types/notificationDigests';
import { ApiError } from '@/services/apiClient';

export interface UseDigestViewResult {
  readonly digest: PersistedDailySummary | null;
  readonly state: GroupState | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly regenerating: boolean;
  readonly regenerateError: string | null;
  readonly lastRegenerateResult: RunDigestResponse | null;
  readonly refresh: () => Promise<void>;
  readonly regenerate: () => Promise<void>;
}

export function useDigestView(groupKey: string, date: string): UseDigestViewResult {
  const { getAccessToken } = useAuth();
  const [digest, setDigest] = useState<PersistedDailySummary | null>(null);
  const [state, setState] = useState<GroupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [lastRegenerateResult, setLastRegenerateResult] = useState<RunDigestResponse | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return (): void => { isMountedRef.current = false; };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const [d, s] = await Promise.allSettled([
        getDigest(token, groupKey, date),
        getDigestState(token, groupKey, date),
      ]);
      if (!isMountedRef.current) return;
      if (d.status === 'fulfilled') {
        setDigest(d.value);
      } else {
        const reason: unknown = d.reason;
        // 404 means "no digest for that date" — keep digest null without error
        if (reason instanceof ApiError && reason.status === 404) {
          setDigest(null);
        } else {
          setError(getErrorMessage(reason, 'Nie udało się pobrać podsumowania'));
        }
      }
      if (s.status === 'fulfilled') {
        setState(s.value);
      } else {
        // State 404 is expected when digest was never generated — keep null silently
        setState(null);
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [getAccessToken, groupKey, date]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const regenerate = useCallback(async (): Promise<void> => {
    if (regenerating) return;
    setRegenerating(true);
    setRegenerateError(null);
    try {
      const token = await getAccessToken();
      const result = await runDigest(token, { groupKey, date });
      if (!isMountedRef.current) return;
      setLastRegenerateResult(result);
      if (result.lockSkipped !== true) {
        await refresh();
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setRegenerateError(getErrorMessage(err, 'Nie udało się wygenerować ponownie'));
      }
    } finally {
      if (isMountedRef.current) setRegenerating(false);
    }
  }, [getAccessToken, groupKey, date, refresh, regenerating]);

  return {
    digest, state, loading, error,
    regenerating, regenerateError, lastRegenerateResult,
    refresh, regenerate,
  };
}
