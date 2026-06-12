/**
 * Unified log stream factory.
 *
 * Replaces the 3-line boilerplate in every server.ts:
 *   createSentryStream(pino.multistream([pino.destination({ dest: 1, sync: false })]))
 *
 * With a single call:
 *   createLogStream()
 *
 * Behavior:
 * - Development: formatted, colorized output via createDevOutputStream
 * - Production: raw JSON to stdout (for Cloud Logging)
 * - Both modes: Sentry stream attached when DSN is configured
 */

import pino from 'pino';
import { createSentryStream } from './transport.js';
import { createDevOutputStream } from './devStream.js';

/**
 * Create the appropriate log stream for the current environment.
 *
 * @returns A pino-compatible writable stream (multistream with optional Sentry)
 */
export function createLogStream(): ReturnType<typeof pino.multistream> {
  const isDev = process.env['NODE_ENV'] === 'development';

  const destination = isDev ? createDevOutputStream() : pino.destination({ dest: 1, sync: false });

  const streams: pino.StreamEntry[] = [{ stream: destination, level: 'trace' as const }];

  return createSentryStream(pino.multistream(streams));
}
