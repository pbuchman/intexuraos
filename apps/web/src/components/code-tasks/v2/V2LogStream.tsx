import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
} from 'lucide-react';
import type { LogLine, MessageStatus } from '@/hooks';
import type { CodeTaskStatus } from '@/types';
import { V2MessageInput } from './V2MessageInput.js';

// --- Tag color mapping (light-first) ---

const TAG_RE = /^(?:\d{2}:\d{2}:\d{2}\.\d{3} )?\[(\w+)\]/;

function extractTag(text: string): string | null {
  return TAG_RE.exec(text)?.[1] ?? null;
}

interface TagStyle {
  text: string;
  border?: string;
  bg?: string;
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
};

function getLogLineClass(text: string): string {
  const tag = extractTag(text);
  if (tag !== null) return TAG_STYLES[tag]?.text ?? 'text-slate-700 dark:text-slate-300';
  if (text.startsWith('  \u2192 ') || text.startsWith('  \u2717 ')) return 'text-slate-500 dark:text-slate-400';
  return 'text-slate-700 dark:text-slate-300';
}

// --- Tool block collapsing ---

interface ToolBlock {
  headerIdx: number;
  bodyStart: number;
  bodyEnd: number;
  finalized: boolean;
}

const TIMESTAMP_PREFIX_RE = /^\d{2}:\d{2}:\d{2}\.\d{3} /;

function isBodyLine(text: string): boolean {
  const stripped = text.replace(TIMESTAMP_PREFIX_RE, '');
  return stripped.startsWith('  \u2192 ') || stripped.startsWith('  \u2717 ') || stripped.startsWith('    ');
}

function countVisualLines(logs: LogLine[], start: number, end: number): number {
  let count = 0;
  for (let i = start; i < end; i++) {
    const line = logs[i];
    if (line !== undefined) {
      count += line.text.split('\n').length;
    }
  }
  return count;
}

// --- LogStream props ---

interface V2LogStreamProps {
  logs: LogLine[];
  isActive: boolean;
  listenerHealthy: boolean;
  taskStatus: CodeTaskStatus;
  onSendMessage: (message: string) => Promise<void>;
  sending: boolean;
  sendError: { code: string; message: string } | null;
  messageStatus: MessageStatus;
  workerOnline: boolean;
  workerName: string;
}

const SMOOTH_SCROLL_GUARD_MS = 500;

export function V2LogStream({ logs, isActive, listenerHealthy, taskStatus, onSendMessage, sending, sendError, messageStatus, workerOnline, workerName }: V2LogStreamProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [followLogs, setFollowLogs] = useState(true);
  const [copied, setCopied] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  const [blockOverrides, setBlockOverrides] = useState<Set<number>>(() => new Set());
  const followRef = useRef(true);
  const prevLogCountRef = useRef(0);
  const isAutoScrollingRef = useRef(false);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Tool block collapsing
  const bodyLineMap = useMemo(() => {
    const blocks: ToolBlock[] = [];
    let current: ToolBlock | null = null;

    const finalizeBlock = (endIdx: number): void => {
      if (current !== null) {
        current.bodyEnd = endIdx;
        current.finalized = true;
        if (current.bodyEnd > current.bodyStart) {
          blocks.push(current);
        }
        current = null;
      }
    };

    for (let i = 0; i < logs.length; i++) {
      const line = logs[i];
      if (line === undefined) continue;
      const text = line.text;
      const tag = extractTag(text);

      if (tag === 'tool') {
        finalizeBlock(i);
        current = { headerIdx: i, bodyStart: i + 1, bodyEnd: i + 1, finalized: false };
      } else if (tag !== null) {
        finalizeBlock(i);
      } else if (current !== null && isBodyLine(text)) {
        current.bodyEnd = i + 1;
      } else {
        finalizeBlock(i);
      }
    }
    if (current !== null && current.bodyEnd > current.bodyStart) {
      blocks.push(current);
    }

    const map = new Map<number, ToolBlock>();
    for (const block of blocks) {
      map.set(block.headerIdx, block);
      for (let j = block.bodyStart; j < block.bodyEnd; j++) {
        map.set(j, block);
      }
    }
    return map;
  }, [logs]);

  // Auto-scroll when new logs arrive and follow mode is on
  useEffect(() => {
    if (logs.length > prevLogCountRef.current && followRef.current) {
      isAutoScrollingRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = setTimeout(() => { isAutoScrollingRef.current = false; }, SMOOTH_SCROLL_GUARD_MS);
    }
    prevLogCountRef.current = logs.length;
    return (): void => { clearTimeout(autoScrollTimerRef.current); };
  }, [logs.length]);

  // Detect manual scroll-up to disable follow
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const onScroll = (): void => {
      if (isAutoScrollingRef.current) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (atBottom && !followRef.current) {
        followRef.current = true;
        setFollowLogs(true);
      } else if (!atBottom && followRef.current) {
        followRef.current = false;
        setFollowLogs(false);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return (): void => { el.removeEventListener('scroll', onScroll); };
  }, []);

  const toggleFollow = (): void => {
    const next = !followRef.current;
    followRef.current = next;
    setFollowLogs(next);
    if (next) {
      isAutoScrollingRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = setTimeout(() => { isAutoScrollingRef.current = false; }, SMOOTH_SCROLL_GUARD_MS);
    }
  };

  const copyAllLogs = useCallback((): void => {
    const text = logs.map((l) => l.text).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    }).catch(() => { /* clipboard unavailable */ });
  }, [logs]);

  const toggleCompact = useCallback((): void => {
    setCompactMode((prev) => !prev);
    setBlockOverrides(new Set());
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

  const showMessageInput = taskStatus !== 'cancelled';

  return (
    <div className="mt-6 mb-6">
      {/* Log header bar */}
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-slate-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Execution Logs</span>
          {isActive && listenerHealthy ? (
            <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 dark:text-slate-500">
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
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {followLogs ? 'Following' : 'Follow'}
              </button>
              <button
                type="button"
                onClick={toggleCompact}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  compactMode
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {compactMode ? 'Collapse All' : 'Expand All'}
              </button>
              <button
                type="button"
                onClick={copyAllLogs}
                className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors dark:hover:text-slate-200 dark:hover:bg-slate-700"
                title={copied ? 'Copied!' : 'Copy all logs'}
              >
                {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Log content area */}
      <div
        ref={containerRef}
        className={`max-h-[80vh] overflow-y-auto border border-t-0 border-slate-200 bg-slate-50 p-3 font-mono text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-900${showMessageInput ? '' : ' rounded-b-lg'}`}
      >
        {logs.length === 0 && isActive ? (
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for logs...
          </div>
        ) : null}
        {logs.length === 0 && !isActive ? (
          <p className="text-slate-500">No logs available.</p>
        ) : null}
        {logs.map((line, idx) => {
          const block = bodyLineMap.get(idx);
          if (block === undefined) {
            return <MemoLogLineRow key={line.sequence} line={line} />;
          }
          const isHeader = idx === block.headerIdx;
          const collapsible = block.finalized && countVisualLines(logs, block.bodyStart, block.bodyEnd) >= 2;
          const collapsed = collapsible && (compactMode !== blockOverrides.has(block.headerIdx));

          if (!isHeader && collapsed) return null;

          return (
            <MemoLogLineRow
              key={line.sequence}
              line={line}
              collapsible={isHeader && collapsible}
              collapsed={isHeader && collapsed}
              hiddenCount={isHeader ? countVisualLines(logs, block.bodyStart, block.bodyEnd) : 0}
              {...(isHeader && collapsible ? { onToggle: toggleBlock } : {})}
              headerIdx={block.headerIdx}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>

      {showMessageInput ? (
        <V2MessageInput
          onSendMessage={onSendMessage}
          sending={sending}
          sendError={sendError}
          messageStatus={messageStatus}
          workerOnline={workerOnline}
          workerName={workerName}
        />
      ) : null}
    </div>
  );
}

// --- LogLineRow ---

interface LogLineRowProps {
  line: LogLine;
  collapsible?: boolean;
  collapsed?: boolean;
  hiddenCount?: number;
  onToggle?: (headerIdx: number) => void;
  headerIdx?: number;
}

const MemoLogLineRow = memo(function LogLineRow({ line, collapsible, collapsed, hiddenCount, onToggle, headerIdx }: LogLineRowProps): React.JSX.Element {
  const tag = extractTag(line.text);
  const style = tag !== null ? TAG_STYLES[tag] : undefined;
  const border = style?.border;
  const extraClass = border !== undefined ? ` border-l-2 ${border} ${style?.bg ?? ''} pl-2` : '';

  if (collapsible === true) {
    const Chevron = collapsed === true ? ChevronRight : ChevronDown;
    return (
      <div
        role="button"
        tabIndex={0}
        className={`whitespace-pre-wrap break-all ${getLogLineClass(line.text)}${extraClass} cursor-pointer select-none flex items-start gap-1 hover:bg-slate-100 dark:hover:bg-slate-800/50 -mx-1 px-1 rounded`}
        onClick={(): void => { if (headerIdx !== undefined) onToggle?.(headerIdx); }}
        onKeyDown={(e): void => {
          if ((e.key === 'Enter' || e.key === ' ') && headerIdx !== undefined) {
            e.preventDefault();
            onToggle?.(headerIdx);
          }
        }}
      >
        <Chevron className="h-4 w-4 mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
        <span className="flex-1">
          {line.text}
          {collapsed === true && hiddenCount !== undefined && hiddenCount > 0 ? (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">(+{String(hiddenCount)} lines)</span>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div className={`whitespace-pre-wrap break-all ${getLogLineClass(line.text)}${extraClass}`}>
      {line.text}
    </div>
  );
}, (prev, next) =>
  prev.line === next.line &&
  prev.collapsed === next.collapsed &&
  prev.collapsible === next.collapsible &&
  prev.hiddenCount === next.hiddenCount
);
