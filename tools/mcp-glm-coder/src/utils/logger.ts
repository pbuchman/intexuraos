import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'glm-coder.log');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function formatMessage(level: string, name: string, msg: string, data?: object): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `${timestamp} [${name}] ${level}: ${msg}${dataStr}`;
}

function log(level: string, name: string, msg: string, data?: object): void {
  const formatted = formatMessage(level, name, msg, data);

  // Tee: both stderr and file
  console.error(formatted);
  appendFileSync(LOG_FILE, formatted + '\n');
}

export interface Logger {
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
  error(msg: string, data?: object): void;
  debug(msg: string, data?: object): void;
  child(name: string): Logger;
}

export function createLogger(name: string): Logger {
  return {
    info: (msg, data) => log('INFO', name, msg, data),
    warn: (msg, data) => log('WARN', name, msg, data),
    error: (msg, data) => log('ERROR', name, msg, data),
    debug: (msg, data) => log('DEBUG', name, msg, data),
    child: (childName) => createLogger(`${name}:${childName}`),
  };
}

export const logger = createLogger('glm-coder');
