import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { formatRelative } from '@/utils/dateFormat';
import type { MergeQueueWatch } from '@/types';

interface WatchStatusCardProps {
  watch: MergeQueueWatch | null;
  onToggle: () => void;
  isToggling: boolean;
  blocked: boolean;
}

function ToggleSwitch({ enabled, disabled, onToggle }: { enabled: boolean; disabled: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export function WatchStatusCard({ watch, onToggle, isToggling, blocked }: WatchStatusCardProps): React.JSX.Element {
  const isActive = watch !== null && watch.status === 'active';
  const isDrained = watch !== null && watch.status === 'drained';
  const hasError = isActive && watch.lastError !== null;

  // No watch, cancelled watch, or blocked branch: simple inline toggle
  if (blocked || watch === null || watch.status === 'cancelled') {
    return (
      <div className="flex items-center gap-3">
        <ToggleSwitch enabled={false} disabled={blocked || isToggling} onToggle={onToggle} />
        <span className="text-sm text-slate-600 dark:text-slate-400">Auto-merge</span>
        {blocked ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">Not available for this branch</span>
        ) : null}
        {isToggling ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
      </div>
    );
  }

  // Active with error
  if (hasError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/30">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="text-sm font-medium text-red-700 dark:text-red-400">Active — Error</span>
          </div>
          <div className="flex items-center gap-3">
            <ToggleSwitch enabled={true} disabled={isToggling} onToggle={onToggle} />
            {isToggling ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
          </div>
        </div>
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">
          {watch.lastError}
          {watch.lastErrorAt !== null ? ` \u00b7 ${formatRelative(watch.lastErrorAt)}` : ''}
        </p>
        <p className="mt-1 text-xs text-red-500 dark:text-red-400/80">
          Merged: {String(watch.mergedPrs.length)} &middot; Skipped: {String(watch.skippedPrs.length)}
        </p>
      </div>
    );
  }

  // Active (no error)
  if (isActive) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/30">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-400">Auto-merge active</span>
          </div>
          <div className="flex items-center gap-3">
            <ToggleSwitch enabled={true} disabled={isToggling} onToggle={onToggle} />
            {isToggling ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
          </div>
        </div>
        <p className="mt-1 text-xs text-blue-600 dark:text-blue-400/80">
          Merged: {String(watch.mergedPrs.length)} &middot; Skipped: {String(watch.skippedPrs.length)}
          {watch.lastTickAt !== null ? ` \u00b7 Last tick: ${formatRelative(watch.lastTickAt)}` : ''}
        </p>
      </div>
    );
  }

  // Drained
  if (isDrained) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/30">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Drained</span>
          </div>
          <div className="flex items-center gap-3">
            <ToggleSwitch enabled={false} disabled={isToggling} onToggle={onToggle} />
            {isToggling ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
          </div>
        </div>
        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400/80">
          Merged: {String(watch.mergedPrs.length)}
          {watch.drainedAt !== null ? ` \u00b7 Completed ${formatRelative(watch.drainedAt)}` : ''}
        </p>
      </div>
    );
  }

  // Fallback (shouldn't happen)
  return (
    <div className="flex items-center gap-3">
      <ToggleSwitch enabled={false} disabled={isToggling} onToggle={onToggle} />
      <span className="text-sm text-slate-600 dark:text-slate-400">Auto-merge</span>
    </div>
  );
}
