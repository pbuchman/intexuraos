import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { getBackfillRun } from '@/services/notificationDigestsApi';
import type { BackfillRun } from '@/types/notificationDigests';

export const BACKFILL_POLL_INTERVAL_MS = 2000;

export interface UseBackfillRunResult {
  readonly run: BackfillRun | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
}

function isTerminal(status: BackfillRun['status']): boolean {
  return status === 'completed' || status === 'failed';
}

export function useBackfillRun(runId: string | undefined): UseBackfillRunResult {
  const { getAccessToken } = useAuth();
  const [run, setRun] = useState<BackfillRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return (): void => { isMountedRef.current = false; };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (runId === undefined || runId === '') {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const token = await getAccessToken();
      const next = await getBackfillRun(token, runId);
      if (!isMountedRef.current) return;
      setRun((prev) => (prev !== null && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Nie udało się pobrać stanu backfillu'));
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [getAccessToken, runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = run?.status;
  useEffect(() => {
    if (status === undefined || isTerminal(status)) return;
    const id = setInterval(() => {
      void refresh();
    }, BACKFILL_POLL_INTERVAL_MS);
    return (): void => { clearInterval(id); };
  }, [status, refresh]);

  return { run, loading, error, refresh };
}
