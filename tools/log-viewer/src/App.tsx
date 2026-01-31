import { useState, useCallback, useRef, useEffect, type MouseEvent } from 'react';
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Radio,
  Trash2,
  Circle,
} from 'lucide-react';
import { usePm2Logs, type Pm2LogEntry } from './usePm2Logs';

function stripLeadingTimestamp(message: string): string {
  return message
    .replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?:?\s*/i, '')
    .replace(/^\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\]:?\s*/i, '')
    .replace(/^\d{2}:\d{2}:\d{2}:?\s*/, '')
    .trim();
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
    [text]
  );

  return (
    <button
      onClick={handleCopy}
      className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

interface LogRowProps {
  log: Pm2LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const levelColors: Record<string, string> = {
  error: 'bg-red-900/50 text-red-300',
  warn: 'bg-yellow-900/50 text-yellow-300',
  info: 'bg-slate-700/50 text-slate-300',
  debug: 'bg-slate-800/50 text-slate-500',
};

function LogRow({ log, isExpanded, onToggle }: LogRowProps): React.JSX.Element {
  const time = new Date(log.timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
  const levelColorClass = levelColors[log.level] ?? 'bg-slate-700/50 text-slate-300';

  return (
    <div className="border-b border-slate-700/50 last:border-0">
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-1 font-mono text-xs hover:bg-slate-800/50"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
        )}
        <span className="w-[85px] shrink-0 text-slate-500">{time}</span>
        <span className={`w-[50px] shrink-0 text-center rounded px-1 ${levelColorClass}`}>
          {log.level}
        </span>
        <span className="w-[150px] shrink-0 truncate text-slate-400">{log.app}</span>
        <span className="min-w-0 flex-1 truncate text-slate-300">
          {stripLeadingTimestamp(log.message)}
        </span>
        {log.url !== null && (
          <span className="max-w-[250px] shrink-0 truncate text-cyan-400/70" title={log.url}>
            {log.url}
          </span>
        )}
        <CopyButton text={JSON.stringify(log.raw, null, 2)} />
      </div>
      {isExpanded && (
        <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all bg-slate-950 p-3 text-xs text-slate-400">
          {JSON.stringify(log.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function App(): React.JSX.Element {
  const { logs, isConnected, clearLogs, apps } = usePm2Logs();
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [followLogs, setFollowLogs] = useState(true);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<string[]>([]);
  const [appFilter, setAppFilter] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (followLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, followLogs]);

  const toggleLogExpanded = useCallback((id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      setFollowLogs(false);
    }
  }, []);

  const toggleLevelFilter = useCallback((level: string) => {
    setLevelFilter((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  }, []);

  const toggleAppFilter = useCallback((app: string) => {
    setAppFilter((prev) => (prev.includes(app) ? prev.filter((a) => a !== app) : [...prev, app]));
  }, []);

  const filteredLogs = logs.filter((l) => {
    if (levelFilter.length > 0 && !levelFilter.includes(l.level)) return false;
    if (appFilter.length > 0 && !appFilter.includes(l.app)) return false;
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      return (
        l.app.toLowerCase().includes(lowerFilter) ||
        l.message.toLowerCase().includes(lowerFilter) ||
        l.level.toLowerCase().includes(lowerFilter) ||
        (l.url?.toLowerCase().includes(lowerFilter) ?? false)
      );
    }
    return true;
  });

  const levels = ['error', 'warn', 'info', 'debug'];

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-4 border-b border-slate-700 bg-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-amber-500">📋 Log Viewer</span>
          <span
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${isConnected ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}
          >
            <Circle className={`h-2 w-2 ${isConnected ? 'fill-emerald-400' : 'fill-red-400'}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span>
            {filteredLogs.length} / {logs.length} logs
          </span>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-850 px-4 py-2">
        {/* Text filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter logs..."
            className="w-64 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
        </div>

        {/* Level filters */}
        <div className="flex items-center gap-1">
          {levels.map((level) => (
            <button
              key={level}
              onClick={() => toggleLevelFilter(level)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                levelFilter.includes(level)
                  ? levelColors[level]
                  : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        {/* App filters */}
        {apps.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto">
            {apps.map((app) => (
              <button
                key={app}
                onClick={() => toggleAppFilter(app)}
                className={`whitespace-nowrap rounded px-2 py-1 text-xs transition-colors ${
                  appFilter.includes(app)
                    ? 'bg-blue-900/50 text-blue-300'
                    : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                }`}
              >
                {app}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setFollowLogs(!followLogs)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              followLogs
                ? 'bg-emerald-900/50 text-emerald-400'
                : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
            }`}
            title="Auto-scroll to newest"
          >
            <Radio className="h-3 w-3" />
            Follow
          </button>
          <button
            onClick={clearLogs}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-red-400"
            title="Clear all logs"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Logs */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onWheel={handleWheel}>
        {filteredLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            {logs.length === 0 ? 'Waiting for logs...' : 'No logs match filters'}
          </div>
        ) : (
          filteredLogs.map((log) => (
            <LogRow
              key={log.id}
              log={log}
              isExpanded={expandedLogs.has(log.id)}
              onToggle={() => toggleLogExpanded(log.id)}
            />
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
