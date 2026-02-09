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
const DOCKER_HEADER_SIZE = 8;

function isDockerHeaderAt(str: string, pos: number): boolean {
  const streamType = str.charCodeAt(pos);
  if (streamType > 2) return false;
  return str.charCodeAt(pos + 1) === 0 && str.charCodeAt(pos + 2) === 0 && str.charCodeAt(pos + 3) === 0;
}

function stripDockerHeaders(raw: string): string {
  let result = '';
  let i = 0;
  while (i < raw.length) {
    if (i + DOCKER_HEADER_SIZE <= raw.length && isDockerHeaderAt(raw, i)) {
      i += DOCKER_HEADER_SIZE;
    } else {
      result += raw.charAt(i);
      i++;
    }
  }
  return result;
}

interface StreamJsonMsg {
  type: string;
  subtype?: string;
  message?: { content?: { type: string; text?: string; name?: string }[] };
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  content?: string;
  result?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  is_error?: boolean;
}

function formatLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;

  let obj: StreamJsonMsg;
  try { obj = JSON.parse(trimmed) as StreamJsonMsg; } catch { return line; }

  switch (obj.type) {
    case 'system': {
      const sub = obj.subtype ?? '';
      if (sub === 'hook_started' || sub === 'hook_response' || sub === 'init') return null;
      return `[system] ${sub}`;
    }
    case 'assistant': {
      const blocks = obj.message?.content;
      if (!Array.isArray(blocks)) return null;
      const parts: string[] = [];
      for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') parts.push(b.text);
        if (b.type === 'tool_use' && typeof b.name === 'string') parts.push(`[tool] ${b.name}`);
      }
      return parts.length > 0 ? parts.join('\n') : null;
    }
    case 'result': {
      if (obj.is_error === true) return `[error] Task failed: ${obj.result ?? 'Unknown error'}`;
      const dur = typeof obj.duration_ms === 'number' ? `${(obj.duration_ms / 1000).toFixed(1)}s`
        : typeof obj.duration_api_ms === 'number' ? `${(obj.duration_api_ms / 1000).toFixed(1)}s` : '?';
      const turns = typeof obj.num_turns === 'number' ? `${String(obj.num_turns)} turn${obj.num_turns !== 1 ? 's' : ''}` : '';
      return `[done] Completed in ${[dur, turns].filter(Boolean).join(', ')}`;
    }
    case 'tool_use': {
      const name = obj.tool_name ?? 'unknown';
      const inp = obj.tool_input;
      let ctx = '';
      if (inp !== undefined) {
        if (typeof inp['file_path'] === 'string') ctx = `: ${inp['file_path']}`;
        else if (typeof inp['command'] === 'string') { const c = inp['command']; ctx = `: ${c.length > 80 ? c.slice(0, 77) + '...' : c}`; }
        else if (typeof inp['pattern'] === 'string') ctx = `: ${inp['pattern']}`;
        else if (typeof inp['query'] === 'string') { const q = inp['query']; ctx = `: ${q.length > 60 ? q.slice(0, 57) + '...' : q}`; }
      }
      return `[tool] ${name}${ctx}`;
    }
    case 'tool_result': {
      const c = obj.content ?? '';
      if (c.trim() === '') return null;
      const abbr = c.length > 200 ? c.slice(0, 200) + '...' : c;
      return `  \u2192 ${abbr.replace(/\n/g, ' ').trim()}`;
    }
    default: return null;
  }
}

function formatLogContent(raw: string): string {
  const stripped = stripDockerHeaders(raw);
  const lines = stripped.split('\n');
  const formatted = lines.map((l) => formatLine(l)).filter((l): l is string => l !== null);
  if (formatted.length === 0) return '';
  return formatted.join('\n') + '\n';
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
  const [chunkCount, setChunkCount] = useState(0);
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

  // Initialize terminal
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

  // Subscribe to Firestore logs
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
        const logsRef = collection(db, 'code_tasks', taskId, 'logs');
        const logsQuery = query(logsRef, orderBy('sequence', 'asc'));

        unsubscribeRef.current = onSnapshot(
          logsQuery,
          (snapshot) => {
            if (!isMountedRef.current) return;

            const terminal = terminalRef.current;
            if (terminal === null) return;

            let newChunks = 0;
            snapshot.forEach((doc) => {
              const data = doc.data();
              const sequence = data['sequence'] as number;

              if (sequence > lastSequenceRef.current) {
                const content = data['content'] as string;
                const display = formatLogContent(content);
                if (display.length > 0) {
                  terminal.write(display);
                }
                lastSequenceRef.current = sequence;
                newChunks++;
              }
            });

            if (newChunks > 0) {
              setChunkCount((prev) => prev + newChunks);
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
            {chunkCount} chunk{chunkCount !== 1 ? 's' : ''}
          </span>
          {chunkCount > 0 ? (
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
