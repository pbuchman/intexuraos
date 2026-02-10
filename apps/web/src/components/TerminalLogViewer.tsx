import { memo, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';
import { CheckCircle2, Copy, Loader2, Terminal } from 'lucide-react';
import { useAuth } from '@/context';
import {
  getFirestoreClient,
  authenticateFirebase,
  isFirebaseAuthenticated,
  initializeFirebase,
} from '@/services/firebase';

const MIN_TERMINAL_ROWS = 10;

interface LogEntryDoc {
  sequence: number;
  type: 'system' | 'assistant_text' | 'tool_call' | 'tool_result' | 'result' | 'raw';
  systemSubtype?: string;
  hookName?: string;
  hookExitCode?: number;
  hookOutput?: string;
  model?: string;
  toolCount?: number;
  mcpServers?: { name: string; status: string }[];
  text?: string;
  toolName?: string;
  toolContext?: string;
  content?: string;
  isError?: boolean;
  resultType?: 'success' | 'error';
  durationMs?: number;
  numTurns?: number;
  totalCostUsd?: number;
  errorMessage?: string;
  rawText?: string;
}

function renderLogEntry(entry: LogEntryDoc): string | null {
  switch (entry.type) {
    case 'system':
      return renderSystem(entry);
    case 'assistant_text':
      return entry.text ?? null;
    case 'tool_call':
      return `[tool] ${entry.toolName ?? 'unknown'}${entry.toolContext !== undefined ? `: ${entry.toolContext}` : ''}`;
    case 'tool_result':
      return renderToolResult(entry);
    case 'result':
      return renderResult(entry);
    case 'raw':
      return entry.rawText ?? null;
    default:
      return null;
  }
}

function renderSystem(entry: LogEntryDoc): string | null {
  const sub = entry.systemSubtype;
  if (sub === 'hook_started') {
    return `[hook] ${entry.hookName ?? 'unknown'}`;
  }
  if (sub === 'hook_response') {
    const status = entry.hookExitCode === 0 ? '\u2713' : '\u2717';
    let line = `[hook] ${entry.hookName ?? 'unknown'} ${status} (exit ${String(entry.hookExitCode ?? '?')})`;
    if (entry.hookOutput !== undefined && entry.hookOutput.trim() !== '') {
      const outputLines = entry.hookOutput.split('\n').filter((l) => l.trim() !== '');
      if (outputLines.length <= 3) {
        line += '\n' + outputLines.map((l) => `  ${l}`).join('\n');
      } else {
        const first2 = outputLines.slice(0, 2).map((l) => `  ${l}`).join('\n');
        const last = outputLines[outputLines.length - 1];
        const hidden = outputLines.length - 3;
        line += `\n${first2}\n  ... ${String(hidden)} more lines ...\n  ${last ?? ''}`;
      }
    }
    return line;
  }
  if (sub === 'init') {
    const parts: string[] = [];
    if (entry.model !== undefined) parts.push(`Model: ${entry.model}`);
    if (entry.toolCount !== undefined) parts.push(`Tools: ${String(entry.toolCount)}`);
    if (entry.mcpServers !== undefined && entry.mcpServers.length > 0) {
      parts.push(`MCP: ${entry.mcpServers.map((s) => s.name).join(', ')}`);
    }
    return `[init] ${parts.join(' | ')}`;
  }
  if (sub !== undefined) {
    return `[system] ${sub}`;
  }
  return '[system]';
}

function renderToolResult(entry: LogEntryDoc): string | null {
  const c = entry.content ?? '';
  if (c.trim() === '') return null;

  const lines = c.split('\n');
  if (lines.length <= 3) {
    const abbreviated = c.length > 200 ? c.slice(0, 200) + '...' : c;
    const singleLine = abbreviated.replace(/\n/g, ' ').trim();
    return `  \u2192 ${singleLine}`;
  }

  return `  \u2192 ${String(lines.length)} lines`;
}

function renderResult(entry: LogEntryDoc): string | null {
  if (entry.resultType === 'error') {
    return `[error] Task failed: ${entry.errorMessage ?? 'Unknown error'}`;
  }

  const parts: string[] = [];
  if (entry.durationMs !== undefined) {
    parts.push(`${(entry.durationMs / 1000).toFixed(1)}s`);
  }
  if (entry.numTurns !== undefined) {
    parts.push(`${String(entry.numTurns)} turn${entry.numTurns !== 1 ? 's' : ''}`);
  }
  if (entry.totalCostUsd !== undefined) {
    parts.push(`$${entry.totalCostUsd.toFixed(3)}`);
  }
  if (parts.length === 0) return '[done] Completed';
  return `[done] Completed in ${parts.join(', ')}`;
}

interface TerminalLogViewerProps {
  taskId: string;
  isActive: boolean;
}

export const TerminalLogViewer = memo(function TerminalLogViewer({
  taskId,
  isActive,
}: TerminalLogViewerProps): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [copied, setCopied] = useState(false);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const firebaseAuthenticatedRef = useRef(false);
  const isMountedRef = useRef(true);
  const lastSequenceRef = useRef(-1);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '.terminal-flow .xterm-viewport { overflow-y: hidden !important; }';
    document.head.appendChild(style);
    return (): void => {
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    if (terminalContainerRef.current === null) return;

    const terminal = new XTerm({
      theme: { background: '#0f172a' },
      fontSize: 13,
      fontFamily: 'monospace',
      convertEol: true,
      scrollback: 10000,
      cursorStyle: 'bar',
      cursorBlink: false,
      disableStdin: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);

    requestAnimationFrame(() => {
      fitAddon.fit();
      terminal.resize(terminal.cols, MIN_TERMINAL_ROWS);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const container = terminalContainerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const dims = fitAddon.proposeDimensions();
        if (dims !== undefined && dims.cols !== terminal.cols) {
          terminal.resize(dims.cols, terminal.rows);
        }
      });
    });
    resizeObserver.observe(container);

    return (): void => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const setupListener = async (): Promise<void> => {
      try {
        if (!firebaseAuthenticatedRef.current || !isFirebaseAuthenticated()) {
          initializeFirebase();
          const token = await getAccessToken();
          await authenticateFirebase(token);
          firebaseAuthenticatedRef.current = true;
        }

        const db = getFirestoreClient();
        const entriesRef = collection(db, 'code_tasks', taskId, 'log_entries');
        const entriesQuery = query(entriesRef, orderBy('sequence', 'asc'));

        unsubscribeRef.current = onSnapshot(
          entriesQuery,
          (snapshot) => {
            if (!isMountedRef.current) return;

            const terminal = terminalRef.current;
            if (terminal === null) return;

            let newEntries = 0;
            snapshot.forEach((doc) => {
              const data = doc.data() as LogEntryDoc;
              const sequence = data.sequence;

              if (sequence > lastSequenceRef.current) {
                const display = renderLogEntry(data);
                if (display !== null && display.length > 0) {
                  terminal.write(display + '\n');
                }
                lastSequenceRef.current = sequence;
                newEntries++;
              }
            });

            if (newEntries > 0) {
              setEntryCount((prev) => prev + newEntries);
              terminal.write('', () => {
                const t = terminalRef.current;
                if (t === null) return;
                const totalLines = t.buffer.active.length;
                if (totalLines > t.rows) {
                  t.resize(t.cols, totalLines);
                }
              });
            }
            setLogsLoading(false);
          },
          (err) => {
            if (isMountedRef.current) {
              setLogsError(err.message);
              setLogsLoading(false);
            }
          }
        );
      } catch (err) {
        if (isMountedRef.current) {
          setLogsError(err instanceof Error ? err.message : 'Failed to load logs');
          setLogsLoading(false);
        }
      }
    };

    void setupListener();

    return (): void => {
      if (unsubscribeRef.current !== null) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [taskId, getAccessToken]);

  const copyLogs = (): void => {
    const terminal = terminalRef.current;
    if (terminal === null) return;

    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line !== undefined) {
        lines.push(line.translateToString(true));
      }
    }
    const text = lines.join('\n').trimEnd();
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  };

  return (
    <div className="mt-6 mb-6">
      <div className="flex items-center justify-between rounded-t-lg bg-slate-800 px-4 py-2 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500/70" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
            <span className="h-3 w-3 rounded-full bg-green-500/70" />
          </div>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-300">Execution Logs</span>
          </div>
          {isActive ? (
            <span className="flex items-center gap-1.5 rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-300">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {entryCount} entr{entryCount !== 1 ? 'ies' : 'y'}
          </span>
          {entryCount > 0 ? (
            <button
              type="button"
              onClick={copyLogs}
              className="rounded p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
              title={copied ? 'Copied!' : 'Copy all logs'}
            >
              {copied ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div className="terminal-flow relative rounded-b-lg bg-slate-900 min-h-[200px]">
        <div ref={terminalContainerRef} className="w-full" />
        {logsLoading ? (
          <div className="absolute inset-0 flex items-center gap-2 rounded-b-lg p-4 text-slate-400 font-mono text-sm bg-slate-900">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading logs...
          </div>
        ) : null}
        {logsError !== null ? (
          <div className="absolute inset-0 rounded-b-lg p-4 text-red-400 font-mono text-sm bg-slate-900">
            Error: {logsError}
          </div>
        ) : null}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.taskId === nextProps.taskId && prevProps.isActive === nextProps.isActive;
});
