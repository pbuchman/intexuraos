import { useId, type JSX } from 'react';
import { Clock } from 'lucide-react';
import {
  MIN_TIMEOUT_HOURS,
  MAX_TIMEOUT_HOURS,
  DEFAULT_TIMEOUT_HOURS,
} from '@intexuraos/code-task-domain/timeout';

interface TimeoutSliderProps {
  value: number;
  onChange: (hours: number) => void;
  disabled?: boolean;
}

/**
 * Per-task timeout selector for the New Code Task page (INT-1585).
 *
 * Renders a 1–12-hour integer slider with a numeric label. The default value
 * is `DEFAULT_TIMEOUT_HOURS` (5h) — when left at the default, the consuming
 * page omits `timeoutHours` from the request body so the orchestrator
 * applies its existing 5-hour default (backward compatible).
 *
 * The visible "Task Timeout" label is associated with the range input via
 * `htmlFor`/`id` so screen readers announce the visible text rather than a
 * separate `aria-label`.
 */
export function TimeoutSlider({
  value,
  onChange,
  disabled,
}: TimeoutSliderProps): JSX.Element {
  const inputId = useId();
  const label = `${String(value)} ${value === 1 ? 'hour' : 'hours'}`;
  const isDefault = value === DEFAULT_TIMEOUT_HOURS;

  return (
    <div>
      <label
        htmlFor={inputId}
        className="flex items-center gap-2 mb-2 text-sm font-medium text-slate-700 dark:text-slate-200"
      >
        <Clock className="h-4 w-4 text-slate-500" aria-hidden="true" />
        Task Timeout
      </label>
      <div className="flex items-center gap-3">
        <input
          id={inputId}
          type="range"
          min={MIN_TIMEOUT_HOURS}
          max={MAX_TIMEOUT_HOURS}
          step={1}
          value={value}
          disabled={disabled === true}
          onChange={(e): void => {
            onChange(Number.parseInt(e.target.value, 10));
          }}
          className="w-full"
        />
        <span className="min-w-[5rem] text-right text-sm font-medium text-slate-700 dark:text-slate-200">
          {label}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {isDefault
          ? `Default — orchestrator will apply ${String(DEFAULT_TIMEOUT_HOURS)} hours.`
          : `Custom — overrides orchestrator default of ${String(DEFAULT_TIMEOUT_HOURS)} hours.`}
      </p>
    </div>
  );
}
