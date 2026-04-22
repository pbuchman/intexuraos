import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBanner } from '@/components/ui';
import { useAuth } from '@/context';
import {
  ApiError,
  getWhatsAppPreferences,
  updateWhatsAppPreferences,
  type NotificationLevel,
} from '@/services';

interface LevelOption {
  value: NotificationLevel;
  title: string;
  description: string;
}

const OPTIONS: readonly LevelOption[] = [
  {
    value: 'all',
    title: 'All messages',
    description:
      'Everything IntexuraOS sends you, including progress updates and summaries.',
  },
  {
    value: 'important',
    title: 'Important only',
    description:
      'Only urgent notifications: task failures, approval requests, and completed long-running work.',
  },
];

export function WhatsAppPreferencesCard(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [level, setLevel] = useState<NotificationLevel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPreferences = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const token = await getAccessToken();
      const prefs = await getWhatsAppPreferences(token);
      setLevel(prefs.notificationLevel);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load preferences');
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const handleSelect = useCallback(
    async (next: NotificationLevel): Promise<void> => {
      if (level === null || next === level) return;

      const previous = level;
      // Optimistic update.
      setLevel(next);
      setError(null);

      try {
        const token = await getAccessToken();
        const confirmed = await updateWhatsAppPreferences(token, {
          notificationLevel: next,
        });
        setLevel(confirmed.notificationLevel);
      } catch (e) {
        // Revert on failure.
        setLevel(previous);
        setError(
          e instanceof ApiError ? e.message : 'Failed to update preferences'
        );
      }
    },
    [getAccessToken, level]
  );

  const disabled = isLoading || level === null;

  return (
    <Card title="Notification Preferences">
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
        Choose which WhatsApp messages from IntexuraOS you want to receive.
      </p>
      <ErrorBanner message={error} className="mb-4" />
      <div className="space-y-3" role="radiogroup" aria-label="Notification level">
        {OPTIONS.map((option) => {
          const checked = level === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                checked
                  ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="whatsapp-notification-level"
                value={option.value}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  void handleSelect(option.value);
                }}
                className="mt-1 h-4 w-4 text-blue-600"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {option.title}
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {option.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </Card>
  );
}
