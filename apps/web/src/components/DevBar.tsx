import { useState, useCallback, type KeyboardEvent } from 'react';
import { config } from '@/config';
import { useApiClient, ApiError } from '@/hooks/useApiClient';
import { useAuth } from '@/context';

// Detect environment: LOCAL dev vs PRE-DEV (cloud functions)
function getEnvironment(): 'LOCAL' | 'PRE-DEV' | null {
  if (typeof window === 'undefined') return null;

  const hostname = window.location.hostname;

  if (import.meta.env.DEV && hostname === 'localhost') {
    return 'LOCAL';
  }

  if (hostname.includes('cloudfunctions.net')) {
    return 'PRE-DEV';
  }

  return null;
}

interface CommandResult {
  success: boolean;
  message: string;
  timestamp: Date;
}

export function DevBar(): React.JSX.Element | null {
  const [isExpanded, setIsExpanded] = useState(false);
  const [command, setCommand] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [results, setResults] = useState<CommandResult[]>([]);
  const { request, isAuthenticated } = useApiClient();
  const { user } = useAuth();

  const environment = getEnvironment();

  const handleSubmit = useCallback(async () => {
    if (command.trim() === '' || isSubmitting) return;

    setIsSubmitting(true);
    const commandText = command.trim();
    setCommand('');

    try {
      await request<{ command: unknown }>(config.commandsAgentServiceUrl, '/commands', {
        method: 'POST',
        body: {
          text: commandText,
          source: 'pwa-shared',
        },
      });

      setResults((prev) => [
        { success: true, message: `Sent: "${commandText}"`, timestamp: new Date() },
        ...prev.slice(0, 9),
      ]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unknown error';
      setResults((prev) => [
        { success: false, message: `Failed: ${message}`, timestamp: new Date() },
        ...prev.slice(0, 9),
      ]);
    } finally {
      setIsSubmitting(false);
    }
  }, [command, isSubmitting, request]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  if (!environment) return null;

  if (!isExpanded) {
    return (
      <button
        onClick={() => {
          setIsExpanded(true);
        }}
        className="fixed bottom-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-white shadow-lg transition-all hover:bg-amber-600 hover:scale-110"
        title={`Open Dev Bar (${environment} Mode)`}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
          />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-amber-500/30 bg-slate-900 text-slate-100 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            <span className="text-sm font-semibold text-amber-500">DEV MODE</span>
          </div>
          <span className="text-xs text-slate-500">|</span>
          <span className="text-xs text-slate-400">
            {isAuthenticated ? (user?.email ?? 'Authenticated') : 'Not authenticated'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs ${environment === 'PRE-DEV' ? 'bg-purple-800 text-purple-300' : 'bg-slate-800 text-slate-400'}`}>
            {environment}
          </span>
          <button
            onClick={() => {
              setIsExpanded(false);
            }}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            title="Collapse"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex gap-4 p-4">
        {/* Command Input Panel */}
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2">
            <svg className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="text-sm font-medium">Send Command</span>
            <span className="text-xs text-slate-500">(simulates WhatsApp message)</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a command... (e.g., 'remind me to call mom tomorrow')"
              disabled={!isAuthenticated || isSubmitting}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
            />
            <button
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!isAuthenticated || isSubmitting || command.trim() === ''}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                'Send'
              )}
            </button>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="mt-3 max-h-24 overflow-y-auto rounded border border-slate-700 bg-slate-800/50">
              {results.map((result, i) => (
                <div
                  key={`${String(result.timestamp.getTime())}-${String(i)}`}
                  className={`flex items-center gap-2 border-b border-slate-700/50 px-3 py-1.5 text-xs last:border-0 ${
                    result.success ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {result.success ? (
                    <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  <span className="truncate">{result.message}</span>
                  <span className="ml-auto flex-shrink-0 text-slate-500">
                    {result.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Future: Service Status Panel */}
        <div className="w-64 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <div className="mb-2 text-xs font-medium text-slate-400">Quick Actions</div>
          <div className="space-y-1 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
              Service monitor (coming soon)
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
              Log viewer (coming soon)
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
              Feature flags (coming soon)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
