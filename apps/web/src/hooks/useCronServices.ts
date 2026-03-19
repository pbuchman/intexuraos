import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listAvailableServices } from '@/services/cronAgentApi';
import type { ServiceInfo } from '@/types';

export function useCronServices(): {
  services: ServiceInfo[];
  loading: boolean;
  error: string | null;
} {
  const { getAccessToken } = useAuth();
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const fetchedRef = useRef(false);

  const fetchServices = useCallback(async (): Promise<void> => {
    if (fetchedRef.current) return;
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listAvailableServices(token);
      if (isMountedRef.current) {
        setServices(data);
        fetchedRef.current = true;
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken]);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchServices();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [fetchServices]);

  return { services, loading, error };
}
