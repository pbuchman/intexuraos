import { useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, Save, TriangleAlert } from 'lucide-react';
import { Button, Card } from '@/components';
import { ApiError } from '@/services';
import {
  getCalendarDailyNotificationSettings,
  updateCalendarDailyNotificationSettings,
} from '@/services/calendarApi.js';
import type { CalendarDailyNotificationSettings } from '@/types';

interface CalendarDailyNotificationCardProps {
  getAccessToken: () => Promise<string>;
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function buildTimeOptions(): string[] {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      options.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
  }
  return options;
}

const TIME_OPTIONS = buildTimeOptions();

function defaultSettings(): CalendarDailyNotificationSettings {
  return {
    schedule: {
      enabled: false,
      localTime: '08:00',
      timeZone: browserTimeZone(),
    },
    delivery: {
      status: 'setup_required',
      reason: 'Matrix outbound delivery has not been checked yet.',
    },
  };
}

export function CalendarDailyNotificationCard({
  getAccessToken,
}: CalendarDailyNotificationCardProps): React.JSX.Element {
  const [settings, setSettings] = useState<CalendarDailyNotificationSettings>(defaultSettings);
  const [enabled, setEnabled] = useState(false);
  const [localTime, setLocalTime] = useState('08:00');
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeOptions = useMemo(() => TIME_OPTIONS, []);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const token = await getAccessToken();
        const response = await getCalendarDailyNotificationSettings(token);
        if (!active) return;
        setSettings(response);
        setEnabled(response.schedule.enabled);
        setLocalTime(response.schedule.localTime);
        setTimeZone(response.schedule.timeZone);
      } catch (e) {
        if (!active) return;
        setError(e instanceof ApiError ? e.message : 'Failed to load daily notification settings');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return (): void => {
      active = false;
    };
  }, [getAccessToken]);

  const deliveryReady = settings.delivery.status === 'ready';
  const deliveryError = settings.delivery.status === 'error';

  const handleSave = async (): Promise<void> => {
    try {
      setSaving(true);
      setSaved(false);
      setError(null);
      const token = await getAccessToken();
      const response = await updateCalendarDailyNotificationSettings(token, {
        enabled,
        localTime,
        timeZone,
      });
      setSettings(response);
      setEnabled(response.schedule.enabled);
      setLocalTime(response.schedule.localTime);
      setTimeZone(response.schedule.timeZone);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save daily notification settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Bell className="h-5 w-5" aria-hidden="true" />
          Daily Calendar Notification
        </span>
      }
    >
      <div className="space-y-4">
        {error !== null && error !== '' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            checked={enabled}
            disabled={loading}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setSaved(false);
            }}
          />
          <span>
            <span className="block font-medium text-slate-900 dark:text-slate-100">
              Send a once-daily lookahead prompt
            </span>
            <span className="block text-slate-600 dark:text-slate-300">
              IntexuraOS will send the calendar lookahead request as your Matrix user.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Time
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              value={localTime}
              disabled={loading || !enabled}
              onChange={(event) => {
                setLocalTime(event.target.value);
                setSaved(false);
              }}
            >
              {timeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Timezone
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              value={timeZone}
              disabled={loading || !enabled}
              onChange={(event) => {
                setTimeZone(event.target.value);
                setSaved(false);
              }}
            />
          </label>
        </div>

        <div
          className={`rounded-lg border p-3 text-sm ${
            deliveryReady
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300'
              : deliveryError
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2">
            {deliveryReady ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden="true" />
            ) : (
              <TriangleAlert className="mt-0.5 h-4 w-4" aria-hidden="true" />
            )}
            <div>
              <p className="font-medium">
                {deliveryReady
                  ? 'Matrix delivery is ready'
                  : deliveryError
                    ? 'Matrix delivery is temporarily unavailable'
                    : 'Matrix delivery setup required'}
              </p>
              {deliveryError ? (
                <p className="mt-1">
                  IntexuraOS could not verify Matrix delivery right now.
                  {settings.delivery.message !== undefined ? ` ${settings.delivery.message}` : ''}
                </p>
              ) : !deliveryReady ? (
                <p className="mt-1">
                  The Matrix host needs the outbound adapter endpoint, auth token, and
                  intex_agent target room mapping before scheduled notifications can be delivered.
                  {settings.delivery.reason !== undefined ? ` ${settings.delivery.reason}` : ''}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {settings.schedule.nextRunAt !== undefined ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Next run: {new Date(settings.schedule.nextRunAt).toLocaleString()}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            isLoading={saving}
            loadingText="Saving..."
            disabled={loading || saving}
            onClick={() => void handleSave()}
          >
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            Save
          </Button>
          {saved ? (
            <span className="text-sm font-medium text-green-700 dark:text-green-300">Saved</span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
