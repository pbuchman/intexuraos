import { useState, useEffect, useCallback, useRef } from 'react';

export interface Pm2LogEntry {
  id: string;
  timestamp: string;
  app: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  url: string | null;
  raw: Record<string, unknown>;
}

interface SSEMessage {
  type: 'connected' | 'log';
  log?: {
    message?: string;
    data?: string;
    process?: { name?: string };
    app_name?: string;
    type?: string;
    status?: string;
    process_id?: number;
    err?: boolean;
    timestamp?: string | number;
  };
}

const LOG_STREAM_URL = 'http://localhost:8106/stream';
const MAX_LOGS = 2000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000];

function extractFirstJson(message: string): Record<string, unknown> | null {
  const jsonStart = message.indexOf('{');
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < message.length; i++) {
    const char = message[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        const jsonStr = message.slice(jsonStart, i + 1);
        try {
          const parsed: unknown = JSON.parse(jsonStr);
          if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function parseLogLevel(log: SSEMessage['log']): Pm2LogEntry['level'] {
  if (log?.err === true || log?.type === 'err') return 'error';

  const message = log?.message ?? log?.data ?? '';

  try {
    const nested = extractFirstJson(message);
    if (nested !== null) {
      const level = nested['level'];
      if (level === 50 || level === 'error') return 'error';
      if (level === 40 || level === 'warn') return 'warn';
      if (level === 20 || level === 'debug') return 'debug';
      if (level === 30 || level === 'info') return 'info';
    }
  } catch {
    // Fall through to string-based detection
  }

  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('error') || lowerMessage.includes('err:')) return 'error';
  if (lowerMessage.includes('warn')) return 'warn';
  if (lowerMessage.includes('debug')) return 'debug';
  return 'info';
}

function parseLogMessage(log: SSEMessage['log']): string {
  const raw = log?.message ?? log?.data ?? '';

  const nested = extractFirstJson(raw);
  if (nested !== null) {
    const msg = nested['msg'];
    const message = nested['message'];
    if (typeof msg === 'string') return msg;
    if (typeof message === 'string') return message;
  }

  const jsonStart = raw.indexOf('{');
  if (jsonStart > 0) {
    return raw.slice(0, jsonStart).trim();
  }

  // For PM2 process events (no nested JSON), show type + status
  if (!raw && log?.type) {
    if (log.status) {
      return `${log.type}: ${log.status}`;
    }
    return log.type;
  }

  return raw || log?.type || '';
}

function extractUrlFromObject(obj: Record<string, unknown>): string | null {
  if (typeof obj['url'] === 'string') return obj['url'];
  if (typeof obj['path'] === 'string') return obj['path'];

  const req = obj['req'];
  if (typeof req === 'object' && req !== null) {
    const reqObj = req as Record<string, unknown>;
    if (typeof reqObj['url'] === 'string') return reqObj['url'];
    if (typeof reqObj['path'] === 'string') return reqObj['path'];
  }

  const request = obj['request'];
  if (typeof request === 'object' && request !== null) {
    const requestObj = request as Record<string, unknown>;
    if (typeof requestObj['url'] === 'string') return requestObj['url'];
    if (typeof requestObj['path'] === 'string') return requestObj['path'];
  }

  return null;
}

function extractUrl(log: SSEMessage['log']): string | null {
  const message = log?.message ?? log?.data ?? '';

  const nested = extractFirstJson(message);
  if (nested !== null) {
    return extractUrlFromObject(nested);
  }

  return null;
}

function generateLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function usePm2Logs(): {
  logs: Pm2LogEntry[];
  isConnected: boolean;
  clearLogs: () => void;
  apps: string[];
} {
  const [logs, setLogs] = useState<Pm2LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [apps, setApps] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    function connect(): void {
      if (eventSourceRef.current !== null) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(LOG_STREAM_URL);
      eventSourceRef.current = eventSource;

      eventSource.onopen = (): void => {
        setIsConnected(true);
        reconnectAttemptRef.current = 0;
      };

      eventSource.onerror = (): void => {
        setIsConnected(false);
        eventSource.close();
        eventSourceRef.current = null;

        const delay =
          RECONNECT_DELAYS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)];
        if (delay !== undefined) {
          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      eventSource.onmessage = (e: MessageEvent<string>): void => {
        try {
          const message = JSON.parse(e.data) as SSEMessage;

          if (message.type === 'log' && message.log !== undefined) {
            const log = message.log;
            const appName = log.app_name ?? log.process?.name ?? 'unknown';
            const timestamp = log.timestamp
              ? new Date(log.timestamp).toISOString()
              : new Date().toISOString();

            const entry: Pm2LogEntry = {
              id: generateLogId(),
              timestamp,
              app: appName,
              level: parseLogLevel(log),
              message: parseLogMessage(log),
              url: extractUrl(log),
              raw: log as Record<string, unknown>,
            };

            setLogs((prev) => {
              const updated = [...prev, entry];
              if (updated.length > MAX_LOGS) {
                return updated.slice(-MAX_LOGS);
              }
              return updated;
            });

            setApps((prev) => {
              if (!prev.includes(appName)) {
                return [...prev, appName].sort();
              }
              return prev;
            });
          }
        } catch {
          // Ignore malformed messages
        }
      };
    }

    connect();

    return (): void => {
      if (eventSourceRef.current !== null) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);

  return { logs, isConnected, clearLogs, apps };
}
