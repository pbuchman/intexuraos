#!/usr/bin/env node

/**
 * PM2 Log Viewer — compact, filtered output for iPad/half-screen monitoring.
 *
 * Usage: pm2 logs | node ~/tools/log-viewer.mjs
 *
 * Parses devStream-formatted output (ANSI-colored) from PM2 log lines.
 * Filters: /health endpoints, PM2 framework noise, verbose extras.
 * Keeps: request flow, errors, warnings, domain messages.
 */

import { createInterface } from 'node:readline';

// ── ANSI helpers ─────────────────────────────────────────────

const R = '\x1b[0m';
const GREY = '\x1b[90m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

/** Strip all ANSI escape codes from a string */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Service name shortening ──────────────────────────────────

const NAME_MAP = {
  'user-ser': 'user',
  'user-service': 'user',
  'code-age': 'code',
  'code-agent': 'code',
  research: 'research',
  'research-agent': 'research',
  command: 'commands',
  commands: 'commands',
  'commands-agent': 'commands',
  'actions-': 'actions',
  actions: 'actions',
  'actions-agent': 'actions',
  'todos-ag': 'todos',
  'todos-agent': 'todos',
  'notes-ag': 'notes',
  'notes-agent': 'notes',
  bookmark: 'bookmarks',
  'bookmarks-agent': 'bookmarks',
  calenda: 'calendar',
  calendar: 'calendar',
  'calendar-agent': 'calendar',
  'chat-age': 'chat',
  'chat-agent': 'chat',
  'linear-a': 'linear',
  'linear-': 'linear',
  'linear-agent': 'linear',
  'data-ins': 'insights',
  'data-insights-agent': 'insights',
  'web-agen': 'web-agent',
  'web-agent': 'web-agent',
  'image-se': 'image',
  'image-service': 'image',
  whatsapp: 'whatsapp',
  'whatsapp-service': 'whatsapp',
  'notion-s': 'notion',
  'notion-service': 'notion',
  'app-sett': 'settings',
  'app-settings-service': 'settings',
  'mobile-n': 'notifs',
  'mobile-notifications-service': 'notifs',
  web: 'web',
};

const NAME_WIDTH = 10;

function shortName(pm2Name) {
  if (!pm2Name) return '???'.padEnd(NAME_WIDTH);
  const trimmed = pm2Name.trim();
  const short = NAME_MAP[trimmed] ?? trimmed.replace(/-service$/, '').replace(/-agent$/, '');
  return short.slice(0, NAME_WIDTH).padEnd(NAME_WIDTH);
}

// ── PM2 line parser ──────────────────────────────────────────

/**
 * PM2 log lines look like:
 *   9|user-ser | [90m01:05:39[0m | [32mINFO [0m | [36m???[0m | incoming request | [90mPOST /auth/firebase-token[0m
 *
 * We extract:
 *   - PM2 service name (from prefix, e.g. "user-ser")
 *   - The rest (devStream formatted content)
 */
function parsePm2Line(raw) {
  // Match PM2 prefix: "ID|name | rest" (with spaces around pipes)
  const pm2Match = raw.match(/^\d+\|([^|]+)\| (.*)/);
  if (!pm2Match) return null;

  const pm2Name = pm2Match[1];
  const content = pm2Match[2];
  return { pm2Name, content };
}

/**
 * Parse the devStream formatted content.
 * Format: HH:mm:ss | LEVEL | name | message | extras
 * (all with ANSI codes)
 */
function parseDevStreamContent(content) {
  const plain = stripAnsi(content);
  // Split on " | " separator
  const parts = plain.split(' | ');
  if (parts.length < 4) return null;

  const time = parts[0].trim();
  const level = parts[1].trim();
  const message = parts[3].trim();
  const extras = parts.length > 4 ? parts.slice(4).join(' | ').trim() : '';

  return { time, level, message, extras };
}

// ── Noise filters ────────────────────────────────────────────

function isNoise(message, extras) {
  const combined = stripAnsi(message) + ' ' + stripAnsi(extras);
  // Health checks
  if (combined.includes('/health')) return true;
  // Server listening (startup noise)
  if (message.startsWith('Server listening at')) return true;
  if (message.includes('listening on 0.0.0.0:')) return true;
  // JWT/auth config
  if (message.startsWith('JWT auth configured')) return true;
  // Fetching/Loaded pricing
  if (message.startsWith('Fetching pricing') || message.startsWith('Loaded pricing')) return true;
  // Code agent streaming log lines (very chatty)
  if (combined.includes('POST /internal/logs')) return true;
  // Incoming request duplicate (devStream logs both "incoming request" and "Received request to")
  if (message === 'Incoming request') return true;
  return false;
}

// ── Level styling ────────────────────────────────────────────

function levelStyle(level) {
  switch (level) {
    case 'ERROR':
      return { symbol: '\u2717', color: RED };
    case 'FATAL':
      return { symbol: '\u2717', color: RED };
    case 'WARN':
      return { symbol: '\u26a0', color: YELLOW };
    case 'INFO':
      return { symbol: ' ', color: '' };
    case 'DEBUG':
      return { symbol: ' ', color: GREY };
    default:
      return { symbol: ' ', color: GREY };
  }
}

// ── Message formatting ───────────────────────────────────────

function formatOutput(name, time, level, message, extras) {
  const { symbol, color } = levelStyle(level);
  // Strip any leftover ANSI from devStream values
  const t = stripAnsi(time);
  const msg = stripAnsi(message);
  const ext = stripAnsi(extras);

  // Request completed — compact status line
  if (msg === 'request completed' && ext) {
    const statusMatch = ext.match(/^(\d{3})\s+(\d+ms)/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]);
      const ms = statusMatch[2];
      const sc = status >= 500 ? RED : status >= 400 ? YELLOW : GREEN;
      return `${GREY}${t}${R} ${CYAN}${name}${R} ${sc}\u2713 ${status}${R} ${GREY}${ms}${R}`;
    }
  }

  // Incoming request — show METHOD /path
  if (msg === 'incoming request' && ext) {
    return `${GREY}${t}${R} ${CYAN}${name}${R} ${ext}`;
  }

  // "Received request to METHOD /path" — extract method/path from message
  if (msg.startsWith('Received request to ')) {
    const reqPart = msg.replace('Received request to ', '');
    return `${GREY}${t}${R} ${CYAN}${name}${R} ${reqPart}`;
  }

  // Error/warn — highlight
  if (level === 'ERROR' || level === 'FATAL') {
    const detail = ext ? ` ${GREY}${ext}${R}` : '';
    return `${GREY}${t}${R} ${CYAN}${name}${R} ${RED}${symbol} ${msg}${R}${detail}`;
  }

  if (level === 'WARN') {
    const detail = ext ? ` ${GREY}${ext}${R}` : '';
    return `${GREY}${t}${R} ${CYAN}${name}${R} ${YELLOW}${symbol} ${msg}${R}${detail}`;
  }

  // Regular domain message
  return `${GREY}${t}${R} ${CYAN}${name}${R} ${msg}`;
}

// ── Main line processor ──────────────────────────────────────

function processLine(raw) {
  const pm2 = parsePm2Line(raw);
  if (!pm2) return null;

  const parsed = parseDevStreamContent(pm2.content);
  if (!parsed) return null;

  // Filter noise
  if (isNoise(parsed.message, parsed.extras)) return null;

  // Filter DEBUG/TRACE
  if (parsed.level === 'DEBUG' || parsed.level === 'TRACE') return null;

  const name = shortName(pm2.pm2Name);
  return formatOutput(name, parsed.time, parsed.level, parsed.message, parsed.extras);
}

// ── Entry point ──────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const output = processLine(line);
  if (output !== null) {
    process.stdout.write(output + '\n');
  }
});

rl.on('close', () => process.exit(0));

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});
