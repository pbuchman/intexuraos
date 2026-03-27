import { useEffect, useRef } from 'react';
import { useAuth } from '@/context';
import { getUserSettings } from '@/services/authApi';
import { patchUserTimezone } from '@/services/userTimezoneApi';

/**
 * Fire-and-forget hook: on first authenticated load, reads the browser's
 * timezone and PATCHes it to user-service only if no timezone is stored yet.
 *
 * Must be called inside AuthProvider.
 */
export function useTimezoneAutoDetect(): void {
  const { isAuthenticated, user, getAccessToken } = useAuth();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || hasRun.current) return;

    const userId = user?.sub;
    if (userId === undefined) return;

    hasRun.current = true; // prevent concurrent runs

    void (async (): Promise<void> => {
      try {
        const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (detectedTimezone === '') return;

        const token = await getAccessToken();
        const settings = await getUserSettings(token, userId);

        // Only write if no timezone is stored — never overwrite a manual selection
        if (settings.timezone !== undefined && settings.timezone !== '') return;

        await patchUserTimezone(token, userId, detectedTimezone);
      } catch {
        // Transient failure — allow retry on next render cycle
        hasRun.current = false;
      }
    })();
  }, [isAuthenticated, user?.sub, getAccessToken]);
}
