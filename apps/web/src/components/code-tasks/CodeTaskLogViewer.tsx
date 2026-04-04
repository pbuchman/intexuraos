import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
} from 'lucide-react';
import type { MessageStatus } from '@/hooks';
import type { LogLine } from '@/hooks/useCodeTaskLogs.js';
import type { CodeTaskStatus } from '@/types';
import { MessageInput } from './MessageInput.js';

const TAG_RE = /^(?:\d{2}:\d{2}:\d{2}\.\d{3} )?\[(\w+)\]/;
const TIMESTAMP_PREFIX_RE = /^\d{2}:\d{2}:\d{2}\.\d{3} /;
const SMOOTH_SCROLL_GUARD_MS = 500;

interface TagStyle {
  text: string;
  border?: string;
  bg?: string;
}

interface ToolBlock {
  headerIdx: number;
  bodyStart: number;
  bodyEnd: number;
}

const TAG_STYLES: Record<string, TagStyle> = {
  user:         { text: 'text-cyan-700 dark:text-cyan-400',       border: 'border-cyan-500/30 dark:border-cyan-800',       bg: 'bg-cyan-500/5 dark:bg-cyan-900/20' },
  queued:       { text: 'text-amber-700 dark:text-amber-400',     border: 'border-amber-500/30 dark:border-amber-700',     bg: 'bg-amber-500/5 dark:bg-amber-900/20' },
  resumed:      { text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-500/30 dark:border-emerald-700', bg: 'bg-emerald-500/5 dark:bg-emerald-900/20' },
  prompt:       { text: 'text-orange-700 dark:text-orange-300',   border: 'border-orange-500/30 dark:border-orange-700',   bg: 'bg-orange-500/5 dark:bg-orange-900/20' },
  instructions: { text: 'text-violet-700 dark:text-violet-300',   border: 'border-violet-500/30 dark:border-violet-700',   bg: 'bg-violet-500/5 dark:bg-violet-900/20' },
  claude:       { text: 'text-blue-700 dark:text-blue-300' },
  tool:         { text: 'text-amber-700 dark:text-yellow-300' },
  error:        { text: 'text-red-700 dark:text-red-400' },
  done:         { text: 'text-green-700 dark:text-green-400' },
  hook:         { text: 'text-purple-700 dark:text-purple-300' },
  init:         { text: 'text-cyan-600 dark:text-cyan-300' },
  system:       { text: 'text-slate-500 dark:text-slate-500' },
  orchestrator: { text: 'text-slate-500 dark:text-slate-500' },
  cmd:          { text: 'text-amber-700 dark:text-yellow-300' },
  msg:          { text: 'text-blue-700 dark:text-blue-300' },
  codex:        { text: 'text-cyan-600 dark:text-cyan-300' },
};

function extractTag(text: string): string | null {
  return TAG_RE.exec(text)?.[1] ?? null;
}

function getLogLineClass(text: string): string {
  const tag = extractTag(text);
  if (tag !== null) return TAG_STYLES[tag]?.text ?? 'text-slate-700 dark:text-slate-300';
  if (text.startsWith('  -> ') || text.startsWith('  ✗ ')) return 'text-slate-500 dark:text-slate-400';
  if (text.startsWith('  \u2192 ') || text.startsWith('  \u2717 ')) return 'text-slate-500 dark:text-slate-400';
  return 'text-slate-700 dark:text-slate-300';
}

function isBodyLine(text: string): boolean {
  const stripped = text.replace(TIMESTAMP_PREFIX_RE, '');
  return stripped.startsWith('  \u2192 ') || stripped.startsWith('  \u2717 ') || stripped.startsWith('    ');
}

function countVisualLines(logs: LogLine[], start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; index++) {
    const line = logs[index];
    if (line !== undefined) {
      count += line.text.split('\n').length;
    }
  }
  return count;
}

export interface CodeTaskLogViewerProps {
  logs: LogLine[];
  isActive: boolean;
  listenerHealthy: boolean;
  taskStatus: CodeTaskStatus;
  workerOnline?: boolean;
  workerName?: string;
  readOnly?: boolean;
  agentType?: string;
  onSendMessage?: (message: string) => Promise<void>;
  sending?: boolean;
  sendError?: { code: string; message: string } | null;
  messageStatus?: MessageStatus;
}

export function CodeTaskLogViewer({
  logs,
  isActive,
  listenerHealthy,
  taskStatus,
  workerOnline = true,
  workerName,
  readOnly = false,
  agentType,
  onSendMessage,
  sending = false,
  sendError = null,
  messageStatus = 'idle',
}: CodeTaskLogViewerProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [followLogs, setFollowLogs] = useState(true);
  const [copied, setCopied] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  const [blockOverrides, setBlockOverrides] = useState<Set<number>>(() => new Set());
  const [claudeFilter, setClaudeFilter] = useState(false);
  const followRef = useRef(true);
  const prevLogCountRef = useRef(0);
  const isAutoScrollingRef = useRef(false);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const bodyLineMap = useMemo(() => {
    const blocks: ToolBlock[] = [];
    let current: ToolBlock | null = null;

    const finalizeBlock = (endIdx: number): void => {
      if (current === null) return;
      current.bodyEnd = endIdx;
      if (current.bodyEnd > current.bodyStart) {
        blocks.push(current);
      }
      current = null;
    };

    for (let index = 0; index < logs.length; index++) {
      const line = logs[index];
      if (line === undefined) continue;
      const tag = extractTag(line.text);

      if (tag === 'tool' || tag === 'cmd') {
        finalizeBlock(index);
        current = { headerIdx: index, bodyStart: index + 1, bodyEnd: index + 1 };
      } else if (tag !== null) {
        finalizeBlock(index);
      } else if (current !== null && isBodyLine(line.text)) {
        current.bodyEnd = index + 1;
      } else {
        finalizeBlock(index);
      }
    }
    if (current !== null && current.bodyEnd > current.bodyStart) {
      blocks.push(current);
    }

    const blockMap = new Map<number, ToolBlock>();
    for (const block of blocks) {
      blockMap.set(block.headerIdx, block);
      for (let index = block.bodyStart; index < block.bodyEnd; index++) {
        blockMap.set(index, block);
      }
    }
    return blockMap;
  }, [logs]);

  useEffect(() => {
    if (logs.length > prevLogCountRef.current && followRef.current) {
      isAutoScrollingRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, SMOOTH_SCROLL_GUARD_MS);
    }
    prevLogCountRef.current = logs.length;
    return (): void => {
      clearTimeout(autoScrollTimerRef.current);
    };
  }, [logs.length]);

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;

    const onScroll = (): void => {
      if (isAutoScrollingRef.current) return;
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      if (atBottom && !followRef.current) {
        followRef.current = true;
        setFollowLogs(true);
      } else if (!atBottom && followRef.current) {
        followRef.current = false;
        setFollowLogs(false);
      }
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    return (): void => {
      element.removeEventListener('scroll', onScroll);
    };
  }, []);

  const toggleFollow = (): void => {
    const next = !followRef.current;
    followRef.current = next;
    setFollowLogs(next);
    if (next) {
      isAutoScrollingRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, SMOOTH_SCROLL_GUARD_MS);
    }
  };

  const copyAllLogs = useCallback((): void => {
    const text = logs.map((line) => line.text).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    }).catch(() => {
      // clipboard unavailable
    });
  }, [logs]);

  const toggleCompact = useCallback((): void => {
    setCompactMode((prev) => !prev);
    setBlockOverrides(new Set());
  }, []);

  const toggleClaudeFilter = useCallback((): void => {
    setClaudeFilter((prev) => !prev);
  }, []);

  const toggleBlock = useCallback((headerIdx: number): void => {
    setBlockOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(headerIdx)) {
        next.delete(headerIdx);
      } else {
        next.add(headerIdx);
      }
      return next;
    });
  }, []);

  const isNonMessagableAgent = agentType === 'review' || agentType === 'remediation';
  const showMessageInput = !readOnly && taskStatus !== 'cancelled' && onSendMessage !== undefined && !isNonMessagableAgent;

  return (
    <div className="mt-6 mb-6">
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-slate-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            <span className="md:hidden">Execution</span>
            <span className="hidden md:inline">Execution Logs</span>
          </span>
          {isActive && listenerHealthy ? (
            <span className="hidden items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 md:flex dark:bg-green-900/50 dark:text-green-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
              Live
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-400 md:inline dark:text-slate-500">
            {String(logs.length)} line{logs.length !== 1 ? 's' : ''}
          </span>
          {logs.length > 0 ? (
            <>
              <button
                type="button"
                onClick={toggleFollow}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  followLogs
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {followLogs ? 'Following' : 'Follow'}
              </button>
              <button
                type="button"
                onClick={toggleClaudeFilter}
                aria-pressed={claudeFilter}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  claudeFilter
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                }`}
              >
                Claude
              </button>
              <button
                type="button"
                onClick={toggleCompact}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  compactMode
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {compactMode ? 'Collapse' : 'Expand'}
              </button>
              <button
                type="button"
                onClick={copyAllLogs}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-b-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
        <div
          ref={containerRef}
          className="max-h-[60vh] overflow-x-auto overflow-y-auto p-3 font-mono text-[13px] leading-6"
        >
          {logs.length === 0 ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isActive ? 'Waiting for logs...' : 'No logs available for this task.'}
              </p>
            </div>
          ) : (
            logs.map((line, index) => {
              const block = bodyLineMap.get(index);
              if (block !== undefined && index > block.headerIdx) {
                return null;
              }
              if (claudeFilter) {
                const tag = extractTag(line.text);
                if (tag !== 'claude') return null;
              }

              const collapsible = block !== undefined && countVisualLines(logs, block.bodyStart, block.bodyEnd) >= 4;
              const collapsed = collapsible && (compactMode !== blockOverrides.has(block.headerIdx));
              const tag = extractTag(line.text);
              const tagStyle = tag === null ? undefined : TAG_STYLES[tag];

              return (
                <div key={`${String(line.sequence)}-${String(index)}`}>
                  <div
                    className={`flex items-start gap-2 rounded px-2 py-0.5 ${
                      tagStyle?.border !== undefined ? `border-l ${tagStyle.border} ${tagStyle.bg ?? ''}` : ''
                    }`}
                  >
                    {block !== undefined && collapsible ? (
                      <button
                        type="button"
                        onClick={(): void => {
                          toggleBlock(block.headerIdx);
                        }}
                        className="mt-1 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label={collapsed ? 'Expand tool output' : 'Collapse tool output'}
                      >
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <pre className={`min-w-0 ${claudeFilter ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${getLogLineClass(line.text)}`}>
                      {line.text}
                    </pre>
                  </div>

                  {block !== undefined && collapsed ? (
                    <button
                      type="button"
                      onClick={(): void => {
                        toggleBlock(block.headerIdx);
                      }}
                      className="ml-6 mt-0.5 rounded px-2 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      {String(countVisualLines(logs, block.bodyStart, block.bodyEnd))} lines hidden
                    </button>
                  ) : null}

                  {block !== undefined && !collapsed ? (
                    logs.slice(block.bodyStart, block.bodyEnd).map((bodyLine, bodyIndex) => (
                      <div key={`${String(bodyLine.sequence)}-${String(bodyIndex)}-body`} className="pl-6">
                        <pre className={`whitespace-pre rounded px-2 py-0.5 ${getLogLineClass(bodyLine.text)}`}>
                          {bodyLine.text}
                        </pre>
                      </div>
                    ))
                  ) : null}
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {showMessageInput ? (
          <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <MessageInput
              onSendMessage={onSendMessage}
              sending={sending}
              sendError={sendError}
              messageStatus={messageStatus}
              workerOnline={workerOnline}
              workerName={workerName ?? ''}
            />
          </div>
        ) : null}
        {isNonMessagableAgent && !readOnly ? (
          <div className="rounded-b-lg border-t border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
            Messages not available for {agentType} tasks
          </div>
        ) : null}
      </div>
    </div>
  );
}
