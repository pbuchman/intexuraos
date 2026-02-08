import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
import { Loader2, Terminal } from 'lucide-react';
import { Card } from '@/components/ui';
import { useAuth } from '@/context';
import {
  getFirestoreClient,
  authenticateFirebase,
  isFirebaseAuthenticated,
  initializeFirebase,
} from '@/services/firebase';

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
  const [logsHeight, setLogsHeight] = useState(384);
  const [isResizing, setIsResizing] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const firebaseAuthenticatedRef = useRef(false);
  const isMountedRef = useRef(true);
  const lastSequenceRef = useRef(-1);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startY = e.clientY;
    const startHeight = logsHeight;

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(200, Math.min(800, startHeight + deltaY));
      setLogsHeight(newHeight);
    };

    const handleMouseUp = (): void => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [logsHeight]);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
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

    // Small delay to let the container settle before fitting
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const container = terminalContainerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
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

  // Re-fit when height changes
  useEffect(() => {
    if (fitAddonRef.current !== null) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    }
  }, [logsHeight]);

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
                terminal.write(content);
                lastSequenceRef.current = sequence;
                newChunks++;
              }
            });

            if (newChunks > 0) {
              setChunkCount((prev) => prev + newChunks);
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

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Execution Logs</h3>
          {isActive ? (
            <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          ) : null}
        </div>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {chunkCount} chunk{chunkCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="relative">
        <div
          className="relative rounded-lg bg-slate-900 overflow-hidden"
          style={{ height: `${String(logsHeight)}px` }}  // eslint-disable-line no-restricted-syntax -- dynamic height value for resizable terminal
        >
          <div ref={terminalContainerRef} className="h-full w-full" />
          {logsLoading ? (
            <div className="absolute inset-0 flex items-center gap-2 p-4 text-slate-400 font-mono text-sm bg-slate-900">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading logs...
            </div>
          ) : null}
          {logsError !== null ? (
            <div className="absolute inset-0 p-4 text-red-400 font-mono text-sm bg-slate-900">Error: {logsError}</div>
          ) : null}
        </div>
        <div
          onMouseDown={handleMouseDown}
          className={`absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize border-t-2 border-transparent hover:border-slate-500 dark:hover:border-slate-400 transition-colors ${isResizing ? 'border-slate-500 dark:border-slate-400' : ''}`}
          title="Drag to resize"
        />
      </div>
    </Card>
  );
}, (prevProps, nextProps) => {
  return prevProps.taskId === nextProps.taskId && prevProps.isActive === nextProps.isActive;
});
