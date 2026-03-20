export function PreferredToolChips({
  preferredTools,
  onRemove,
  emptyLabel,
  className = 'flex flex-wrap gap-2',
  disabled = false,
}: {
  preferredTools: string[];
  onRemove?: (toolName: string) => void;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
}): React.JSX.Element {
  if (preferredTools.length === 0) {
    return (
      <span className="text-xs text-slate-400 dark:text-slate-500">
        {emptyLabel ?? 'No preferred tools configured'}
      </span>
    );
  }

  return (
    <div className={className}>
      {preferredTools.map((toolName) => (
        onRemove !== undefined ? (
          <button
            key={toolName}
            type="button"
            onClick={(): void => {
              onRemove(toolName);
            }}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            <span className="font-mono">{toolName}</span>
            <span aria-hidden="true">x</span>
          </button>
        ) : (
          <span
            key={toolName}
            className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          >
            {toolName}
          </span>
        )
      ))}
    </div>
  );
}
