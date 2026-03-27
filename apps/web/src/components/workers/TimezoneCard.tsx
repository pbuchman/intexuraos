import { useState } from 'react';
import { Card } from '@/components';

export interface TimezoneCardProps {
  currentTimezone: string | null;
  saving: boolean;
  error: string | null;
  onUpdate: (timezone: string) => Promise<void>;
}

// Group IANA timezone names by region prefix for usability
function groupTimezones(timezones: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const tz of timezones) {
    const slashIdx = tz.indexOf('/');
    const region = slashIdx === -1 ? 'Other' : tz.slice(0, slashIdx);
    const existing = groups.get(region);
    if (existing !== undefined) {
      existing.push(tz);
    } else {
      groups.set(region, [tz]);
    }
  }
  return groups;
}

const ALL_TIMEZONES: string[] = ((): string[] => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
})();

const GROUPED_TIMEZONES = groupTimezones(ALL_TIMEZONES);

const BROWSER_TIMEZONE: string = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function TimezoneCard({
  currentTimezone,
  saving,
  error,
  onUpdate,
}: TimezoneCardProps): React.JSX.Element {
  const [saveSuccess, setSaveSuccess] = useState(false);

  const displayTimezone = currentTimezone ?? BROWSER_TIMEZONE;

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const value = e.target.value;
    if (value === '' || value === currentTimezone) return;
    setSaveSuccess(false);
    try {
      await onUpdate(value);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    } catch {
      // error is surfaced via the error prop from the parent hook
    }
  };

  return (
    <Card>
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Timezone</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Used for displaying times in automation logs and scheduled tasks.
        </p>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      ) : null}

      {saveSuccess ? (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/30">
          <p className="text-sm font-medium text-green-800 dark:text-green-300">&#10003; Timezone saved</p>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <select
          value={displayTimezone}
          onChange={(e): void => {
            void handleChange(e);
          }}
          disabled={saving}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
        >
          {Array.from(GROUPED_TIMEZONES.entries()).map(([region, tzList]) => (
            <optgroup key={region} label={region}>
              {tzList.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {saving ? (
          <svg className="h-5 w-5 animate-spin text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : null}
      </div>
    </Card>
  );
}
