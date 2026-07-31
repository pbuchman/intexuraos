import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import type {
  MessageDigestDeliveryReadiness,
  MessageDigestSchedule,
  MessageDigestSchedulePreview,
  MessageDigestWeekday,
} from '@/types/messageDigests';
import {
  formatMessageDigestDateTime,
  maskMessageDigestPrimaryNumber,
} from '@/types/messageDigests';

const WEEKDAYS: readonly { value: MessageDigestWeekday; label: string }[] = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
];

export interface MessageDigestScheduleFieldsProps {
  value: MessageDigestSchedule;
  onChange: (value: MessageDigestSchedule) => void;
  timeZones: string[];
  preview: MessageDigestSchedulePreview | null;
  previewLoading: boolean;
  previewError: string | null;
  readiness: MessageDigestDeliveryReadiness | null;
  readinessLoading: boolean;
  readinessError: string | null;
  activeRequested: boolean;
  localTimeError?: string | undefined;
  timeZoneError?: string | undefined;
  localTimeRef?: React.RefObject<HTMLInputElement | null> | undefined;
  timeZoneRef?: React.RefObject<HTMLSelectElement | null> | undefined;
  onRefreshReadiness?: (() => Promise<void>) | undefined;
}

export function MessageDigestScheduleFields({
  value,
  onChange,
  timeZones,
  preview,
  previewLoading,
  previewError,
  readiness,
  readinessLoading,
  readinessError,
  activeRequested,
  localTimeError,
  timeZoneError,
  localTimeRef,
  timeZoneRef,
  onRefreshReadiness,
}: MessageDigestScheduleFieldsProps): React.JSX.Element {
  const cadenceName = useId();
  const setCadence = (kind: MessageDigestSchedule['kind']): void => {
    if (kind === 'weekly') {
      onChange({
        kind,
        weekday: value.kind === 'weekly' ? value.weekday : 'monday',
        localTime: value.localTime,
        timeZone: value.timeZone,
      });
      return;
    }
    onChange({ kind, localTime: value.localTime, timeZone: value.timeZone });
  };

  return (
    <div className="grid min-w-0 gap-5">
      <fieldset>
        <legend className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Cadence
        </legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <CadenceChoice
            name={cadenceName}
            checked={value.kind === 'daily'}
            label="Every day"
            description="One summary every local calendar day."
            onSelect={(): void => {
              setCadence('daily');
            }}
          />
          <CadenceChoice
            name={cadenceName}
            checked={value.kind === 'weekdays'}
            label="Weekdays"
            description="Monday through Friday in the selected zone."
            onSelect={(): void => {
              setCadence('weekdays');
            }}
          />
          <CadenceChoice
            name={cadenceName}
            checked={value.kind === 'weekly'}
            label="Weekly"
            description="One selected local day each week."
            onSelect={(): void => {
              setCadence('weekly');
            }}
          />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {value.kind === 'weekly' ? (
          <label className="block">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Day of week
            </span>
            <select
              aria-label="Day of week"
              value={value.weekday}
              onChange={(event): void => {
                onChange({ ...value, weekday: event.target.value as MessageDigestWeekday });
              }}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {WEEKDAYS.map((weekday) => (
                <option key={weekday.value} value={weekday.value}>
                  {weekday.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Delivery time
          </span>
          <input
            ref={localTimeRef}
            type="time"
            aria-label="Delivery time"
            value={value.localTime}
            aria-invalid={localTimeError !== undefined}
            aria-describedby={
              localTimeError === undefined ? undefined : 'digest-local-time-error'
            }
            onChange={(event): void => {
              onChange({ ...value, localTime: event.target.value });
            }}
            className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {localTimeError !== undefined ? (
            <span
              id="digest-local-time-error"
              role="alert"
              className="mt-1.5 block text-sm text-red-600 dark:text-red-400"
            >
              {localTimeError}
            </span>
          ) : null}
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Time zone
          </span>
          <select
            ref={timeZoneRef}
            aria-label="Time zone"
            value={value.timeZone}
            aria-invalid={timeZoneError !== undefined}
            aria-describedby={
              timeZoneError === undefined ? undefined : 'digest-time-zone-error'
            }
            onChange={(event): void => {
              onChange({ ...value, timeZone: event.target.value });
            }}
            className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {timeZones.map((timeZone) => (
              <option key={timeZone} value={timeZone}>
                {timeZone}
              </option>
            ))}
          </select>
          {timeZoneError !== undefined ? (
            <span
              id="digest-time-zone-error"
              role="alert"
              className="mt-1.5 block text-sm text-red-600 dark:text-red-400"
            >
              {timeZoneError}
            </span>
          ) : null}
        </label>
      </div>

      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        Daylight-saving transitions use the first valid instant that day when a local time does not
        exist. If the local time occurs twice, the earlier occurrence is used.
      </p>

      <SchedulePreviewCard preview={preview} loading={previewLoading} error={previewError} />
      <DeliveryReadinessCard
        readiness={readiness}
        loading={readinessLoading}
        error={readinessError}
        activeRequested={activeRequested}
        {...(onRefreshReadiness === undefined ? {} : { onRefresh: onRefreshReadiness })}
      />
    </div>
  );
}

function CadenceChoice({
  name,
  checked,
  label,
  description,
  onSelect,
}: {
  name: string;
  checked: boolean;
  label: string;
  description: string;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <label
      className={`flex min-h-24 cursor-pointer gap-3 rounded-xl border p-3 ${checked ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'}`}
    >
      <input
        type="radio"
        name={name}
        aria-label={label}
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-950 dark:text-slate-50">
          {label}
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
          {description}
        </span>
      </span>
    </label>
  );
}

function SchedulePreviewCard({
  preview,
  loading,
  error,
}: {
  preview: MessageDigestSchedulePreview | null;
  loading: boolean;
  error: string | null;
}): React.JSX.Element {
  if (loading) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400"
      >
        <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        Calculating the next delivery window…
      </div>
    );
  }
  if (error !== null) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
      >
        <AlertTriangle aria-hidden="true" className="mr-2 inline h-4 w-4" />
        {error}
      </div>
    );
  }
  if (preview === null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
        Enter a valid time and time zone to calculate the next delivery.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
      <p className="flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
        <Clock3 aria-hidden="true" className="h-4 w-4" />
        Next delivery: {formatMessageDigestDateTime(preview.nextBoundary, preview.timeZone)}
      </p>
      <p className="mt-1 text-xs leading-5 text-blue-700 dark:text-blue-300">
        The first digest window starts after{' '}
        {formatMessageDigestDateTime(preview.precedingBoundary, preview.timeZone)}. Times are
        calculated by the service in {preview.timeZone}.
      </p>
    </div>
  );
}

function DeliveryReadinessCard({
  readiness,
  loading,
  error,
  activeRequested,
  onRefresh,
}: {
  readiness: MessageDigestDeliveryReadiness | null;
  loading: boolean;
  error: string | null;
  activeRequested: boolean;
  onRefresh?: () => Promise<void>;
}): React.JSX.Element {
  if (loading) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
      >
        <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        Checking WhatsApp delivery…
      </div>
    );
  }
  if (error !== null || readiness === null) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
      >
        <p className="font-semibold">WhatsApp delivery status unavailable</p>
        <p className="mt-1">Retry before saving an active digest.</p>
        {onRefresh !== undefined ? (
          <button
            type="button"
            onClick={(): void => void onRefresh()}
            className="mt-2 inline-flex min-h-11 items-center font-semibold underline focus:outline-none focus:ring-2 focus:ring-amber-600"
          >
            Retry delivery check
          </button>
        ) : null}
        <WhatsAppSettingsLink />
      </div>
    );
  }
  if (readiness.status === 'ready') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          WhatsApp delivery is ready
        </p>
        <p className="mt-1">
          Summaries will be sent to {maskMessageDigestPrimaryNumber(readiness.maskedPrimaryNumber)},
          the first number mapped to your account.
        </p>
        <WhatsAppSettingsLink />
      </div>
    );
  }
  const title = {
    mapping_missing: 'No primary WhatsApp number is mapped',
    disconnected: 'WhatsApp delivery is disconnected',
    delivery_disabled: 'WhatsApp delivery is disabled',
  }[readiness.status];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle aria-hidden="true" className="h-4 w-4" />
        {title}
      </p>
      <p className="mt-1">
        {activeRequested
          ? 'The service may save an active digest as paused until delivery becomes ready.'
          : 'This paused digest can be configured now and activated after delivery is ready.'}
      </p>
      <WhatsAppSettingsLink />
    </div>
  );
}

function WhatsAppSettingsLink(): React.JSX.Element {
  return (
    <Link
      to="/settings/whatsapp"
      aria-label="Open WhatsApp settings"
      className="mt-2 inline-flex min-h-11 items-center font-semibold underline focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      Open WhatsApp settings
    </Link>
  );
}
