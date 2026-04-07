import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context';
import { getUserSettings } from '@/services/authApi';
import { patchUserTimezone } from '@/services/userTimezoneApi';
import { getErrorMessage } from '@intexuraos/common-core/errors';

interface UseTimezoneResult {
  timezone: string | null;
  saving: boolean;
  error: string | null;
  updateTimezone: (newTimezone: string) => Promise<void>;
}

export function useTimezone(): UseTimezoneResult {
  const { isAuthenticated, user, getAccessToken } = useAuth();
  const [timezone, setTimezone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const userId = user?.sub;
    if (!isAuthenticated || userId === undefined) {
      return;
    }

    setError(null);

    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const settings = await getUserSettings(token, userId);
        setTimezone(settings.timezone ?? null);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    })();
  }, [isAuthenticated, user?.sub, getAccessToken]);

  const updateTimezone = useCallback(
    async (newTimezone: string): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      setSaving(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const result = await patchUserTimezone(token, userId, newTimezone);
        setTimezone(result.timezone);
      } catch (err) {
        setError(getErrorMessage(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [user?.sub, getAccessToken]
  );

  return { timezone, saving, error, updateTimezone };
}
