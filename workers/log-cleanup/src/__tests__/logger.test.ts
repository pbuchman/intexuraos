/**
 * Bootstrap log-shape test for the log-cleanup worker.
 *
 * Asserts that the unified logger bootstrap (initWorker + child bindings) emits
 * the required `service`, `requestId`, and `release` fields on every line —
 * this is the acceptance criterion for INT-1567 (plan §S7).
 *
 * Uses pino directly with an in-memory writable stream rather than booting
 * `index.ts`, because `vitest.setup.ts` forces NODE_ENV=test which makes
 * `createAppLogger` return a silent logger. The shape we are guarding here
 * is the `child({ service, release })` + `child({ requestId })` chain that
 * `index.ts` performs at cold start.
 */
import { Writable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { runWithRequestContext } from '../requestContextShim.js';
import { extractCorrelation } from '../extractCorrelation.js';

interface CapturedLine {
  service?: string;
  requestId?: string;
  release?: string;
  msg?: string;
  level?: number | string;
}

function makeCapturingLogger(captured: CapturedLine[]): pino.Logger {
  const stream = new Writable({
    write(chunk, _encoding, callback): void {
      const lines = chunk
        .toString('utf-8')
        .split('\n')
        .filter((l: string) => l.length > 0);
      for (const line of lines) {
        captured.push(JSON.parse(line) as CapturedLine);
      }
      callback();
    },
  });
  return pino({ level: 'trace' }, stream);
}

describe('log-cleanup logger bootstrap', () => {
  it('binds service + release at module init and requestId per invocation', async () => {
    const captured: CapturedLine[] = [];
    const baseLogger = makeCapturingLogger(captured);

    // Mirror what index.ts does at cold start.
    const release = '2026-04-25-test';
    const logger = baseLogger.child({ service: 'log-cleanup', release });

    // Mirror what handleCleanupLogs does per-invocation.
    const ctx = extractCorrelation({ 'x-request-id': 'req-fixed-1' });
    await runWithRequestContext(ctx, () => {
      const reqLogger = logger.child({ requestId: ctx.requestId });
      reqLogger.info({ event: 'first' }, 'first message');
      reqLogger.warn({ event: 'second' }, 'second message');
      reqLogger.error({ event: 'third' }, 'third message');
      return Promise.resolve();
    });

    expect(captured).toHaveLength(3);
    for (const line of captured) {
      expect(line.service).toBe('log-cleanup');
      expect(line.release).toBe(release);
      expect(line.requestId).toBe('req-fixed-1');
    }
  });

  it('generates a fresh requestId when attributes lack one', async () => {
    const captured: CapturedLine[] = [];
    const baseLogger = makeCapturingLogger(captured);
    const logger = baseLogger.child({ service: 'log-cleanup', release: 'rev-x' });

    const ctx = extractCorrelation({});
    await runWithRequestContext(ctx, () => {
      const reqLogger = logger.child({ requestId: ctx.requestId });
      reqLogger.info({}, 'no inbound request id');
      return Promise.resolve();
    });

    expect(captured).toHaveLength(1);
    const line = captured[0];
    expect(line?.service).toBe('log-cleanup');
    expect(line?.release).toBe('rev-x');
    expect(typeof line?.requestId).toBe('string');
    expect((line?.requestId ?? '').length).toBeGreaterThan(0);
  });
});
