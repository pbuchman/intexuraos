import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getLlmUsageEvent } from '@/services/llmUsageApi';
import type { UsageEvent } from '@/types';

export interface UseLlmUsageEventResult {
  event: UsageEvent | null;
  loading: boolean;
  error: string | null;
}

export function useLlmUsageEvent(eventId: string): UseLlmUsageEventResult {
  const { getAccessToken } = useAuth();
  const [event, setEvent] = useState<UsageEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    const fetchEvent = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const token = await getAccessToken();
        const response = await getLlmUsageEvent(token, eventId);

        if (isMountedRef.current) {
          setEvent(response.event);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(getErrorMessage(err, 'Failed to load usage event'));
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    void fetchEvent();

    return (): void => {
      isMountedRef.current = false;
    };
  }, [eventId, getAccessToken]);

  return { event, loading, error };
}
