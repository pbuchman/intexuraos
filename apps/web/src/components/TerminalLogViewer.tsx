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
import { ArrowDownToLine, CheckCircle2, Copy, Loader2, Maximize2, Terminal, X } from 'lucide-react';
import { useAuth } from '@/context';
import {
  getFirestoreClient,
  authenticateFirebase,
  isFirebaseAuthenticated,
  initializeFirebase,
} from '@/services/firebase';
import { sendTaskMessage } from '@/services/codeAgentApi.js';
import { TerminalMessageInput } from '@/components/TerminalMessageInput.js';
import type { CodeTaskStatus } from '@/types';

const MAX_TERMINAL_ROWS = 70;

interface LogLineDoc {
  sequence: number;
  text: string;
}

interface TerminalLogViewerProps {
  taskId: string;
  isActive: boolean;
  taskStatus: CodeTaskStatus;
}

export const TerminalLogViewer = memo(function TerminalLogViewer({
  taskId,
  isActive,
  taskStatus,
}: TerminalLogViewerProps): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [followLogs, setFollowLogs] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const followLogsRef = useRef(true);

  const terminalWrapperRef = useRef<HTMLDivElement>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const firebaseAuthenticatedRef = useRef(false);
  const isMountedRef = useRef(true);
  const isAutoScrollingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateMobileState = (): void => {
      setIsMobileViewport(mediaQuery.matches);
    };
    updateMobileState();
    mediaQuery.addEventListener('change', updateMobileState);
    return (): void => {
      mediaQuery.removeEventListener('change', updateMobileState);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsOverlayOpen(false);
    }
  }, [isMobileViewport]);

  const isFullscreen = isMobileViewport && isOverlayOpen;
  const isRunningStatus = taskStatus === 'running' || taskStatus === 'dispatched';

  useEffect(() => {
    const wrapper = terminalWrapperRef.current;
    const body = terminalBodyRef.current;
    if (wrapper === null || body === null || isFullscreen) {
      if (body !== null) body.style.maxHeight = '';
      return;
    }

    const updateMaxHeight = (): void => {
      const rect = wrapper.getBoundingClientRect();
      const headerHeight = 44;
      const bottomPadding = 24;
      const available = window.innerHeight - rect.top - headerHeight - bottomPadding;
      body.style.maxHeight = `${String(Math.max(200, available))}px`;
    };

    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);
    return (): void => {
      window.removeEventListener('resize', updateMaxHeight);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousWidth = document.body.style.width;
    const previousHeight = document.body.style.height;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    document.body.classList.add('terminal-fullscreen');

    return (): void => {
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.width = previousWidth;
      document.body.style.height = previousHeight;
      document.body.classList.remove('terminal-fullscreen');
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (terminalContainerRef.current === null) return;

    const terminal = new XTerm({
      theme: { background: '#0f172a' },
      fontSize: isMobileViewport ? 11 : 13,
      fontFamily: 'monospace',
      convertEol: true,
      scrollback: 10000,
      cursorStyle: 'bar',
      cursorBlink: false,
      disableStdin: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);

    requestAnimationFrame(() => {
      fitAddon.fit();
      terminal.resize(terminal.cols, MAX_TERMINAL_ROWS);
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

    const scrollDisposable = terminal.onScroll(() => {
      if (isAutoScrollingRef.current) return;
      if (!followLogsRef.current) return;

      const buffer = terminal.buffer.active;
      const isAtBottom = buffer.viewportY >= buffer.baseY;
      if (!isAtBottom) {
        followLogsRef.current = false;
        setFollowLogs(false);
      }
    });

    return (): void => {
      scrollDisposable.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      const terminal = terminalRef.current;
      if (terminal !== null) {
        terminal.resize(terminal.cols, MAX_TERMINAL_ROWS);
      }
    });
  }, [isFullscreen]);

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
        const linesRef = collection(db, 'code_tasks', taskId, 'log_lines');
        const linesQuery = query(linesRef, orderBy('sequence', 'asc'));

        unsubscribeRef.current = onSnapshot(
          linesQuery,
          (snapshot) => {
            if (!isMountedRef.current) return;
            const terminal = terminalRef.current;
            if (terminal === null) return;

            const addedLines: LogLineDoc[] = [];
            for (const change of snapshot.docChanges()) {
              if (change.type === 'added') {
                addedLines.push(change.doc.data() as LogLineDoc);
              }
            }

            if (addedLines.length === 0) {
              setLogsLoading(false);
              return;
            }

            addedLines.sort((a, b) => a.sequence - b.sequence);
            for (const line of addedLines) {
              terminal.write(line.text + '\n');
            }

            setLineCount((prev) => prev + addedLines.length);
            if (followLogsRef.current) {
              isAutoScrollingRef.current = true;
              terminal.scrollToBottom();
              requestAnimationFrame(() => {
                isAutoScrollingRef.current = false;
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

  const toggleFollow = (): void => {
    const next = !followLogsRef.current;
    followLogsRef.current = next;
    setFollowLogs(next);
    if (next) {
      isAutoScrollingRef.current = true;
      terminalRef.current?.scrollToBottom();
      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false;
      });
    }
  };

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
      setTimeout(() => { setCopied(false); }, 2000);
    });
  };

  const handleOpenOverlay = (): void => {
    if (isMobileViewport && !isFullscreen) {
      setIsOverlayOpen(true);
    }
  };

  const handleSendMessage = async (message: string): Promise<void> => {
    const token = await getAccessToken();
    await sendTaskMessage(token, taskId, { message });
  };

  return (
    <div ref={terminalWrapperRef} className={isFullscreen ? 'fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-sm' : 'mt-6 mb-6'}>
      <div
        className={`flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 ${isFullscreen ? 'safe-area-inset-top py-3' : 'rounded-t-lg py-2'}`}
      >
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
            {lineCount} line{lineCount !== 1 ? 's' : ''}
          </span>
          {isMobileViewport && !isFullscreen ? (
            <button
              type="button"
              onClick={() => {
                setIsOverlayOpen(true);
              }}
              className="rounded p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
              title="Open fullscreen terminal"
              aria-label="Open fullscreen terminal"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          ) : null}
          {lineCount > 0 ? (
            <>
              <button
                type="button"
                onClick={toggleFollow}
                className={`rounded p-1.5 transition-colors ${followLogs ? 'text-blue-400 hover:text-blue-300 bg-blue-900/30' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
                title={followLogs ? 'Following logs (click to stop)' : 'Follow logs'}
              >
                <ArrowDownToLine className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={copyLogs}
                className="rounded p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                title={copied ? 'Copied!' : 'Copy all logs'}
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </>
          ) : null}
          {isFullscreen ? (
            <button
              type="button"
              onClick={() => {
                setIsOverlayOpen(false);
              }}
              className="rounded p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
              title="Close fullscreen terminal"
              aria-label="Close fullscreen terminal"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={terminalBodyRef}
        className={`terminal-flow relative bg-slate-900 ${isFullscreen ? 'flex-1 min-h-0 overflow-hidden' : `min-h-[200px] overflow-y-auto ${isRunningStatus ? '' : 'rounded-b-lg'}`}`}
        onClick={isMobileViewport && !isFullscreen ? handleOpenOverlay : undefined}
      >
        <div
          ref={terminalContainerRef}
          className="w-full p-2"
        />
        {logsLoading ? (
          <div className={`absolute inset-0 flex items-center gap-2 p-4 text-slate-400 font-mono text-sm bg-slate-900 ${isRunningStatus ? '' : 'rounded-b-lg'}`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading logs...
          </div>
        ) : null}
        {logsError !== null ? (
          <div className={`absolute inset-0 p-4 text-red-400 font-mono text-sm bg-slate-900 ${isRunningStatus ? '' : 'rounded-b-lg'}`}>
            Error: {logsError}
          </div>
        ) : null}
      </div>
      {!isFullscreen ? (
        <TerminalMessageInput taskStatus={taskStatus} onSend={handleSendMessage} />
      ) : null}
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.taskId === nextProps.taskId && prevProps.isActive === nextProps.isActive && prevProps.taskStatus === nextProps.taskStatus;
});
