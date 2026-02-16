/**
 * Dev-mode formatted log output for PM2.
 *
 * Parses pino JSON log lines and writes formatted, colorized output:
 * service-name | HH:mm:ss | LEVEL | message | {extras}
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

/** Fields excluded from the trailing extras JSON */
const EXCLUDED_FIELDS = new Set(['level', 'time', 'msg', 'name', 'pid', 'hostname']);

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

  // Build extras object (everything not in EXCLUDED_FIELDS)
  const extras: Record<string, unknown> = {};
  let hasExtras = false;
  for (const key of Object.keys(parsed)) {
    if (!EXCLUDED_FIELDS.has(key)) {
      extras[key] = parsed[key];
      hasExtras = true;
    }
  }

  const parts = [
    `${CYAN}${nameStr}${RESET}`,
    `${GREY}${timeStr}${RESET}`,
    `${color}${label}${RESET}`,
    msgStr,
  ];

  if (hasExtras) {
    parts.push(`${GREY}${JSON.stringify(extras)}${RESET}`);
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
