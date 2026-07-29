import { useEffect, useState } from 'react';
import type {
  MessageDigestDeliveryStatus,
  MessageDigestGenerationStatus,
} from '@/types/messageDigests';

export interface MessageDigestHistoryFilterValue {
  fromDate: string;
  toDate: string;
  generationStatus: MessageDigestGenerationStatus | undefined;
  deliveryStatus: MessageDigestDeliveryStatus | undefined;
  direction: 'asc' | 'desc';
}

interface MessageDigestHistoryFiltersProps {
  value: MessageDigestHistoryFilterValue;
  onChange: (value: MessageDigestHistoryFilterValue) => void;
  onClear: () => void;
}

export function MessageDigestHistoryFilters({
  value,
  onChange,
  onClear,
}: MessageDigestHistoryFiltersProps): React.JSX.Element {
  const [draftDates, setDraftDates] = useState({
    fromDate: value.fromDate,
    toDate: value.toDate,
  });

  useEffect(() => {
    setDraftDates({ fromDate: value.fromDate, toDate: value.toDate });
  }, [value.fromDate, value.toDate]);

  const invalidDateRange = isInvalidDateRange(draftDates);
  const effectiveValue: MessageDigestHistoryFilterValue = {
    ...value,
    ...(invalidDateRange ? {} : draftDates),
  };
  const hasFilters = hasMessageDigestHistoryFilters({ ...value, ...draftDates });

  const updateDates = (nextDates: { fromDate: string; toDate: string }): void => {
    setDraftDates(nextDates);
    if (!isInvalidDateRange(nextDates)) {
      onChange({ ...value, ...nextDates });
    }
  };

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      aria-label="History filters"
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <FilterLabel label="From date">
          <input
            type="date"
            aria-label="From date"
            aria-invalid={invalidDateRange || undefined}
            aria-describedby={invalidDateRange ? DATE_RANGE_ERROR_ID : undefined}
            value={draftDates.fromDate}
            max={draftDates.toDate === '' ? undefined : draftDates.toDate}
            onChange={(event): void => {
              updateDates({ ...draftDates, fromDate: event.target.value });
            }}
            className={`${CONTROL_CLASS} ${invalidDateRange ? ERROR_CONTROL_CLASS : ''}`}
          />
        </FilterLabel>
        <FilterLabel label="To date">
          <input
            type="date"
            aria-label="To date"
            aria-invalid={invalidDateRange || undefined}
            aria-describedby={invalidDateRange ? DATE_RANGE_ERROR_ID : undefined}
            value={draftDates.toDate}
            min={draftDates.fromDate === '' ? undefined : draftDates.fromDate}
            onChange={(event): void => {
              updateDates({ ...draftDates, toDate: event.target.value });
            }}
            className={`${CONTROL_CLASS} ${invalidDateRange ? ERROR_CONTROL_CLASS : ''}`}
          />
        </FilterLabel>
        <FilterLabel label="Generation status">
          <select
            aria-label="Generation status"
            value={value.generationStatus ?? ''}
            onChange={(event): void => {
              onChange({
                ...effectiveValue,
                generationStatus:
                  event.target.value === ''
                    ? undefined
                    : (event.target.value as MessageDigestGenerationStatus),
              });
            }}
            className={CONTROL_CLASS}
          >
            <option value="">All generation states</option>
            <option value="queued">Queued</option>
            <option value="processing">Generating</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="skipped_no_activity">Skipped — no new messages</option>
          </select>
        </FilterLabel>
        <FilterLabel label="WhatsApp status">
          <select
            aria-label="WhatsApp status"
            value={value.deliveryStatus ?? ''}
            onChange={(event): void => {
              onChange({
                ...effectiveValue,
                deliveryStatus:
                  event.target.value === ''
                    ? undefined
                    : (event.target.value as MessageDigestDeliveryStatus),
              });
            }}
            className={CONTROL_CLASS}
          >
            <option value="">All delivery states</option>
            <option value="not_sent">Not sent</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="ambiguous">Send status needs review</option>
            <option value="failed">Failed</option>
          </select>
        </FilterLabel>
        <FilterLabel label="History order">
          <select
            aria-label="History order"
            value={value.direction}
            onChange={(event): void => {
              onChange({
                ...effectiveValue,
                direction: event.target.value === 'asc' ? 'asc' : 'desc',
              });
            }}
            className={CONTROL_CLASS}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </FilterLabel>
      </div>
      {invalidDateRange ? (
        <p
          id={DATE_RANGE_ERROR_ID}
          role="alert"
          className="mt-3 text-sm font-medium text-red-700 dark:text-red-300"
        >
          From date must be on or before To date.
        </p>
      ) : null}
      {hasFilters ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/40"
        >
          Clear filters
        </button>
      ) : null}
    </section>
  );
}

export function hasMessageDigestHistoryFilters(value: MessageDigestHistoryFilterValue): boolean {
  return (
    value.fromDate !== '' ||
    value.toDate !== '' ||
    value.generationStatus !== undefined ||
    value.deliveryStatus !== undefined ||
    value.direction !== 'desc'
  );
}

const CONTROL_CLASS =
  'mt-1.5 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const ERROR_CONTROL_CLASS =
  'border-red-500 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500';
const DATE_RANGE_ERROR_ID = 'message-digest-history-date-range-error';

function isInvalidDateRange(value: { fromDate: string; toDate: string }): boolean {
  return value.fromDate !== '' && value.toDate !== '' && value.fromDate > value.toDate;
}

function FilterLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="min-w-0">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
