/**
 * Dev-mode formatted log output for PM2.
 *
 * Parses pino JSON log lines and writes formatted, colorized output:
 * HH:mm:ss | LEVEL | service-name | message | key=val key=val
 *
 * Used only in NODE_ENV=development. Production keeps raw JSON for Cloud Logging.
 */

import { Writable } from 'node:stream';

/** ANSI color codes */
const RESET = '\x1b[0m';
const GREY = '\x1b[90m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

/** Pino level number → label + ANSI color */
const LEVEL_MAP: Record<number, { label: string; color: string }> = {
  10: { label: 'TRACE', color: GREY },
  20: { label: 'DEBUG', color: CYAN },
  30: { label: 'INFO ', color: GREEN },
  40: { label: 'WARN ', color: YELLOW },
  50: { label: 'ERROR', color: RED },
  60: { label: 'FATAL', color: MAGENTA },
};

/** Fields excluded from key=val extras (handled as dedicated columns or noise) */
const EXCLUDED_FIELDS = new Set([
  'level',
  'time',
  'msg',
  'name',
  'pid',
  'hostname',
  'reqId', // Fastify auto-generated, noise in dev
  'req', // handled specially — inlined as METHOD /path
  'res', // handled specially — inlined as status code
  'responseTime', // handled specially — inlined as Xms
]);

/** Correlation fields required to locate warning/error/fatal events in PM2 logs. */
const CORRELATION_FIELDS = new Set([
  'requestId',
  'request_id',
  'reqId',
  'req_id',
  'taskId',
  'task_id',
  'traceId',
  'trace_id',
]);

/** Threshold for truncating long string values */
const TRUNCATE_LEN = 32;

function getLevelInfo(level: number): { label: string; color: string } {
  return LEVEL_MAP[level] ?? { label: `LVL${String(level)}`, color: GREY };
}

function formatTime(epoch: number): string {
  const d = new Date(epoch);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Truncate long strings (UUIDs, tokens, etc.) preserving start and end */
function truncateValue(str: string): string {
  if (str.length <= TRUNCATE_LEN) return str;
  return `${str.slice(0, 8)}…${str.slice(-4)}`;
}

/** Format a single extra value as a human-readable string */
function formatValue(key: string, value: unknown, preserveCorrelations: boolean): string {
  if (typeof value === 'string') {
    return preserveCorrelations && CORRELATION_FIELDS.has(key) ? value : truncateValue(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const json = JSON.stringify(value);
    return json.length <= TRUNCATE_LEN ? json : `[${String(value.length)} items]`;
  }
  // Nested object — compact JSON, truncated
  const json = JSON.stringify(value);
  return json.length <= TRUNCATE_LEN ? json : `${json.slice(0, TRUNCATE_LEN)}…`;
}

/** Format extras as key=val pairs with special handling for Fastify req/res */
function formatExtras(parsed: Record<string, unknown>, level: number): string {
  const parts: string[] = [];
  const preserveCorrelations = level >= 40;

  // Special: res.statusCode as bare number
  const res = parsed['res'];
  if (typeof res === 'object' && res !== null && 'statusCode' in (res as Record<string, unknown>)) {
    parts.push(String((res as Record<string, unknown>)['statusCode']));
  }

  // Special: responseTime as Xms
  const rt = parsed['responseTime'];
  if (typeof rt === 'number') {
    parts.push(`${String(Math.round(rt))}ms`);
  }

  // Special: req as METHOD /path
  const req = parsed['req'];
  if (typeof req === 'object' && req !== null) {
    const r = req as Record<string, unknown>;
    if ('method' in r && 'url' in r) {
      parts.push(`${String(r['method'])} ${String(r['url'])}`);
    }
  }

  // Everything else as key=val
  for (const key of Object.keys(parsed)) {
    if (EXCLUDED_FIELDS.has(key) && !(key === 'reqId' && preserveCorrelations)) continue;
    parts.push(`${key}=${formatValue(key, parsed[key], preserveCorrelations)}`);
  }

  return parts.join(' ');
}

function formatLogLine(data: string): string {
  const parsed = JSON.parse(data) as Record<string, unknown>;

  const level = parsed['level'] as number | undefined;
  const time = parsed['time'] as number | undefined;
  const msg = parsed['msg'] as string | undefined;
  const name = parsed['name'] as string | undefined;

  const { label, color } = getLevelInfo(level ?? 30);
  const timeStr = time !== undefined ? formatTime(time) : '--:--:--';
  const nameStr = name ?? '???';
  const msgStr = msg ?? '';

  const extrasStr = formatExtras(parsed, level ?? 30);

  const parts = [
    `${GREY}${timeStr}${RESET}`,
    `${color}${label}${RESET}`,
    `${CYAN}${nameStr}${RESET}`,
    msgStr,
  ];

  if (extrasStr !== '') {
    parts.push(`${GREY}${extrasStr}${RESET}`);
  }

  return parts.join(' | ');
}

/**
 * Create a writable stream that formats pino JSON for dev-mode readability.
 *
 * @param writeFn - Optional function to write output (defaults to process.stdout.write).
 *                  Accepts the formatted line WITHOUT a trailing newline.
 *                  Useful for testing.
 */
export function createDevOutputStream(writeFn?: (line: string) => void): NodeJS.WritableStream {
  const write = writeFn ?? ((line: string): boolean => process.stdout.write(line + '\n'));

  return new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void): void {
      const raw = chunk.toString().trimEnd();

      // Try to parse as JSON and format
      if (raw.startsWith('{')) {
        try {
          const formatted = formatLogLine(raw);
          write(formatted);
          callback();
          return;
        } catch {
          // Fall through to passthrough
        }
      }

      // Non-JSON: pass through as-is
      write(raw);
      callback();
    },
  }) as unknown as NodeJS.WritableStream;
}
