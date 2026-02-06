interface CommandResult {
  success: boolean;
  message: string;
  timestamp: Date;
}

interface DevBarCommandsTabProps {
  results: CommandResult[];
}

export function DevBarCommandsTab({ results }: DevBarCommandsTabProps): React.JSX.Element {
  if (results.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        <div className="text-center">
          <svg
            className="mx-auto h-8 w-8 text-slate-600 mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p>No commands sent yet</p>
          <p className="text-xs text-slate-600 mt-1">Use the input above to send a command</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="mb-2 text-xs font-medium text-slate-400">Recent Commands</div>
      {results.map((result, i) => (
        <div
          key={`${String(result.timestamp.getTime())}-${String(i)}`}
          className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
            result.success
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {result.success ? (
            <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          <span className="flex-1 truncate">{result.message}</span>
          <span className="flex-shrink-0 text-slate-500">
            {result.timestamp.toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}
