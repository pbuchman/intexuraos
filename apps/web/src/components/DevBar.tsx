import { useState, useCallback, useEffect, useMemo, type KeyboardEvent } from 'react';
import { config } from '@/config';
import { useApiClient, ApiError } from '@/hooks/useApiClient';
import { useAuth } from '@/context';
import { usePubSubEvents } from '@/hooks/usePubSubEvents';
import { usePm2Logs } from '@/hooks/usePm2Logs';
import { useDevBarState } from '@/hooks/useDevBarState';
import {
  DevBarCommandsTab,
  DevBarPubSubTab,
  DevBarLogsTab,
  ConnectionStatus,
  ResizeHandle,
} from './devbar/index.js';

function getEnvironment(): 'DEV' | null {
  if (import.meta.env['INTEXURAOS_ENVIRONMENT'] === 'development') return 'DEV';
  if (import.meta.env.DEV) return 'DEV';
  return null;
}

interface CommandResult {
  success: boolean;
  message: string;
  timestamp: Date;
}

export function DevBar(): React.JSX.Element | null {
  const {
    isExpanded,
    setIsExpanded,
    activeTab,
    setActiveTab,
    height,
    setHeight,
    width,
    setWidth,
    persistedLogs,
    persistLogs,
    persistedPubSubEvents,
    persistPubSubEvents,
    filters,
    setFilters,
  } = useDevBarState();

  const [command, setCommand] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [results, setResults] = useState<CommandResult[]>([]);
  const [isResizing, setIsResizing] = useState(false);
  const { request, isAuthenticated } = useApiClient();
  const { user } = useAuth();

  const environment = getEnvironment();

  const {
    events: livePubsubEvents,
    isConnected: isPubSubConnected,
    clearEvents,
    topics,
  } = usePubSubEvents(isExpanded && activeTab === 'pubsub');

  const {
    logs: liveLogs,
    isConnected: isLogsConnected,
    clearLogs: clearLiveLogs,
    apps,
  } = usePm2Logs(isExpanded && activeTab === 'logs');

  const allLogs = useMemo(() => {
    const liveIds = new Set(liveLogs.map((l) => l.id));
    const uniquePersistedLogs = persistedLogs.filter((l) => !liveIds.has(l.id));
    return [...liveLogs, ...uniquePersistedLogs];
  }, [liveLogs, persistedLogs]);

  const allPubSubEvents = useMemo(() => {
    const liveIds = new Set(livePubsubEvents.map((e) => e.messageId));
    const uniquePersistedEvents = persistedPubSubEvents.filter((e) => !liveIds.has(e.messageId));
    return [...livePubsubEvents, ...uniquePersistedEvents];
  }, [livePubsubEvents, persistedPubSubEvents]);

  useEffect(() => {
    if (liveLogs.length === 0) return undefined;
    const handler = setTimeout(() => {
      persistLogs(liveLogs);
    }, 1000);
    return (): void => {
      clearTimeout(handler);
    };
  }, [liveLogs, persistLogs]);

  useEffect(() => {
    if (livePubsubEvents.length === 0) return undefined;
    const handler = setTimeout(() => {
      persistPubSubEvents(livePubsubEvents);
    }, 1000);
    return (): void => {
      clearTimeout(handler);
    };
  }, [livePubsubEvents, persistPubSubEvents]);

  const clearLogs = useCallback(() => {
    clearLiveLogs();
    persistLogs([]);
  }, [clearLiveLogs, persistLogs]);

  const clearPubSubEvents = useCallback(() => {
    clearEvents();
    persistPubSubEvents([]);
  }, [clearEvents, persistPubSubEvents]);

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

  const handleHeightResize = useCallback(
    (delta: number) => {
      setIsResizing(true);
      setHeight((prev) => prev + delta);
    },
    [setHeight]
  );

  const handleWidthResize = useCallback(
    (delta: number) => {
      setIsResizing(true);
      setWidth((prev) => prev + delta);
    },
    [setWidth]
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  const handleLogLevelsChange = useCallback(
    (levels: ('error' | 'warn' | 'info' | 'debug')[]) => {
      setFilters({ logLevels: levels });
    },
    [setFilters]
  );

  const handleLogAppChange = useCallback(
    (app: string) => {
      setFilters({ logApp: app });
    },
    [setFilters]
  );

  const handlePubSubTopicsChange = useCallback(
    (selectedTopics: string[]) => {
      setFilters({ pubsubTopics: selectedTopics });
    },
    [setFilters]
  );

  const handleFollowLogsChange = useCallback(
    (followLogs: boolean) => {
      setFilters({ followLogs });
    },
    [setFilters]
  );

  const handleFollowPubSubChange = useCallback(
    (followPubSub: boolean) => {
      setFilters({ followPubSub });
    },
    [setFilters]
  );

  if (environment === null) return null;

  if (!isExpanded) {
    return (
      <button
        onClick={() => {
          setIsExpanded(true);
        }}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-amber-500 text-white shadow-lg transition-all hover:bg-amber-600 hover:scale-105"
        title={`Open Dev Bar (${environment} Mode)`}
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

  const tabs: { id: 'commands' | 'pubsub' | 'logs'; label: string; hasConnection?: boolean; isConnected?: boolean }[] = [
    { id: 'commands', label: 'Commands' },
    { id: 'pubsub', label: 'Pub/Sub', hasConnection: true, isConnected: isPubSubConnected },
    { id: 'logs', label: 'Logs', hasConnection: true, isConnected: isLogsConnected },
  ];

  const isFullWidth = width >= window.innerWidth - 10;

  return (
    <div
      className={`fixed bottom-0 right-0 z-50 flex flex-col border-t border-amber-500/30 bg-slate-900 text-slate-100 shadow-2xl ${isResizing ? 'select-none' : ''} ${isFullWidth ? 'left-0' : 'border-l border-amber-500/30'}`}
      // eslint-disable-next-line no-restricted-syntax -- Dynamic resize dimensions require inline style (Tailwind classes are static)
      style={{ height: `${String(height)}px`, width: isFullWidth ? '100%' : `${String(width)}px` }}
    >
      <ResizeHandle position="top" onResize={handleHeightResize} onResizeEnd={handleResizeEnd} />
      <ResizeHandle position="left" onResize={handleWidthResize} onResizeEnd={handleResizeEnd} />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Dev Mode Indicator */}
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            <span className="text-sm font-semibold text-amber-500">DEV</span>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 ml-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {tab.label}
                {tab.hasConnection === true && (
                  <ConnectionStatus isConnected={tab.isConnected === true} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Command Input in Header */}
        <div className="flex flex-1 items-center gap-2 mx-4 max-w-xl">
          <input
            type="text"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Send command..."
            disabled={!isAuthenticated || isSubmitting}
            className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!isAuthenticated || isSubmitting || command.trim() === ''}
            className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-slate-900 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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

        {/* Right side */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setWidth(isFullWidth ? 800 : window.innerWidth);
            }}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            title={isFullWidth ? 'Half width' : 'Full width'}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isFullWidth ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l-7 7 7 7M15 5l7 7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5l7 7-7 7M9 19l-7-7 7-7" />
              )}
            </svg>
          </button>
          <span className="text-xs text-slate-500">
            {isAuthenticated ? (user?.email ?? 'Auth') : 'No auth'}
          </span>
          <span className="rounded px-2 py-0.5 text-xs bg-slate-800 text-slate-400">
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
      <div className="flex-1 overflow-hidden p-4">
        {activeTab === 'commands' && <DevBarCommandsTab results={results} />}
        {activeTab === 'pubsub' && (
          <DevBarPubSubTab
            events={allPubSubEvents}
            isConnected={isPubSubConnected}
            topics={topics}
            onClear={clearPubSubEvents}
            selectedTopics={filters.pubsubTopics}
            onTopicsChange={handlePubSubTopicsChange}
            follow={filters.followPubSub}
            onFollowChange={handleFollowPubSubChange}
          />
        )}
        {activeTab === 'logs' && (
          <DevBarLogsTab
            logs={allLogs}
            isConnected={isLogsConnected}
            apps={apps}
            onClear={clearLogs}
            enabledLevels={filters.logLevels}
            selectedApp={filters.logApp}
            onLevelsChange={handleLogLevelsChange}
            onAppChange={handleLogAppChange}
            follow={filters.followLogs}
            onFollowChange={handleFollowLogsChange}
          />
        )}
      </div>
    </div>
  );
}
