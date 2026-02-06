import { useMemo, useEffect, useRef } from 'react';
import type { Pm2LogEntry } from '@/hooks/usePm2Logs';
import { FilterChip } from './FilterChip.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { ExpandableItem } from './ExpandableItem.js';
import { JsonView } from './JsonView.js';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];

interface DevBarLogsTabProps {
  logs: Pm2LogEntry[];
  isConnected: boolean;
  apps: string[];
  onClear: () => void;
  enabledLevels: LogLevel[];
  selectedApp: string;
  onLevelsChange: (levels: LogLevel[]) => void;
  onAppChange: (app: string) => void;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

export function DevBarLogsTab({
  logs,
  isConnected,
  apps,
  onClear,
  enabledLevels,
  selectedApp,
  onLevelsChange,
  onAppChange,
  follow,
  onFollowChange,
}: DevBarLogsTabProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const enabledSet = useMemo(() => new Set(enabledLevels), [enabledLevels]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (!enabledSet.has(log.level)) return false;
      if (selectedApp !== 'all' && log.app !== selectedApp) return false;
      return true;
    });
  }, [logs, enabledSet, selectedApp]);

  useEffect(() => {
    if (follow && scrollRef.current !== null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs, follow]);

  const toggleLevel = (level: LogLevel): void => {
    if (enabledSet.has(level)) {
      onLevelsChange(enabledLevels.filter((l) => l !== level));
    } else {
      onLevelsChange([...enabledLevels, level]);
    }
  };

  const levelColors: Record<LogLevel, 'error' | 'warn' | 'info' | 'debug'> = {
    error: 'error',
    warn: 'warn',
    info: 'info',
    debug: 'debug',
  };

  const levelBgColors: Record<LogLevel, string> = {
    error: 'bg-red-500/20 text-red-400',
    warn: 'bg-yellow-500/20 text-yellow-400',
    info: 'bg-blue-500/20 text-blue-400',
    debug: 'bg-slate-500/20 text-slate-400',
  };

  return (
    <div className="flex h-full flex-col">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 pb-2 mb-2">
        <span className="text-xs text-slate-500">Level:</span>
        {LOG_LEVELS.map((level) => (
          <FilterChip
            key={level}
            label={level.toUpperCase()}
            isActive={enabledSet.has(level)}
            onClick={() => {
              toggleLevel(level);
            }}
            color={levelColors[level]}
          />
        ))}
        <span className="text-xs text-slate-500 ml-2">App:</span>
        <select
          value={selectedApp}
          onChange={(e) => {
            onAppChange(e.target.value);
          }}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
        >
          <option value="all">All</option>
          {apps.map((app) => (
            <option key={app} value={app}>
              {app}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => {
              onFollowChange(!follow);
            }}
            className={`flex items-center gap-1 text-xs transition-colors ${
              follow ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'
            }`}
            title={follow ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            Follow
          </button>
          <ConnectionStatus isConnected={isConnected} label={isConnected ? 'Live' : 'Disconnected'} />
          <button
            onClick={onClear}
            className="text-xs text-slate-500 hover:text-slate-300"
            title="Clear logs"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-0.5">
        {filteredLogs.length === 0 ? (
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p>No logs yet</p>
              <p className="text-xs text-slate-600 mt-1">Logs will stream here in real-time</p>
            </div>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <ExpandableItem
              key={log.id}
              className="rounded border-l border-transparent hover:border-amber-500"
              expandedContent={<JsonView data={log.raw} />}
            >
              <div className="flex flex-1 items-center gap-1.5 px-1 py-0.5 text-[11px]">
                <span className="w-14 flex-shrink-0 text-slate-500 font-mono text-[10px]">
                  {new Date(log.timestamp).toLocaleTimeString('en-GB')}
                </span>
                <span
                  className={`w-12 flex-shrink-0 rounded px-1 text-center font-medium text-[10px] uppercase ${levelBgColors[log.level]}`}
                >
                  {log.level}
                </span>
                <span className="w-28 flex-shrink-0 truncate text-slate-500 font-medium text-[10px]">
                  {log.app}
                </span>
                <span className="flex-1 truncate text-slate-300">{log.message}</span>
              </div>
            </ExpandableItem>
          ))
        )}
      </div>
    </div>
  );
}
