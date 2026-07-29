import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import * as Sentry from '@sentry/node';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { initSentry } from '../init.js';
import { createSentryStream } from '../transport.js';

const PUBLIC_KEY = '0123456789abcdef0123456789abcdef';
const PROJECT_ID = '42';
const RELEASE = '1234567890abcdef1234567890abcdef12345678';

describe('Error Hub DSN compatibility', () => {
  const originalDsn = process.env['INTEXURAOS_SENTRY_DSN'];

  afterEach(async () => {
    if (originalDsn === undefined) {
      delete process.env['INTEXURAOS_SENTRY_DSN'];
    } else {
      process.env['INTEXURAOS_SENTRY_DSN'] = originalDsn;
    }
    await Sentry.close(2_000);
  });

  it('sends only warning, error, and fatal Pino records through the existing SDK envelope endpoint', async () => {
    const capture = await startEnvelopeCapture();
    const dsn = `http://${PUBLIC_KEY}@127.0.0.1:${String(capture.port)}/${PROJECT_ID}`;
    process.env['INTEXURAOS_SENTRY_DSN'] = dsn;
    initSentry({
      dsn,
      environment: 'dev',
      release: RELEASE,
      serviceName: 'code-agent',
      tracesSampleRate: 0,
    });
    const discardedStdout = new Writable({
      write(_chunk, _encoding, callback): void {
        callback();
      },
    });
    const stream = createSentryStream(
      pino.multistream([{ level: 'debug', stream: discardedStdout }])
    );
    const logger = pino({ level: 'debug' }, stream);

    logger.debug({ requestId: 'req-debug' }, 'hub debug');
    logger.info({ requestId: 'req-info' }, 'hub info');
    logger.warn({ requestId: 'req-warning' }, 'hub warning');
    logger.error({ requestId: 'req-error' }, 'hub error');
    logger.fatal({ requestId: 'req-fatal' }, 'hub fatal');

    expect(await Sentry.flush(5_000)).toBe(true);
    await capture.stop();

    for (const request of capture.requests) {
      const url = new URL(request.url, 'http://error-hub.invalid');
      expect(url.pathname).toBe(`/api/${PROJECT_ID}/envelope/`);
      expect(url.searchParams.get('sentry_key')).toBe(PUBLIC_KEY);
      expect(url.searchParams.get('sentry_version')).toBe('7');
    }
    const events = capture.requests.flatMap(({ body }) => eventItems(body));
    expect(events).toHaveLength(3);
    expect(events.map((event) => event['level']).sort()).toEqual(['error', 'fatal', 'warning']);
    expect(events.map(eventMessage).sort()).toEqual(['hub error', 'hub fatal', 'hub warning']);
    for (const event of events) {
      expect(event['environment']).toBe('dev');
      expect(event['release']).toBe(RELEASE);
      expect(event['server_name']).toBe('code-agent');
    }
    expect(JSON.stringify(events)).not.toContain('hub debug');
    expect(JSON.stringify(events)).not.toContain('hub info');
  });
});

interface CapturedRequest {
  readonly url: string;
  readonly body: string;
}

async function startEnvelopeCapture(): Promise<{
  readonly port: number;
  readonly requests: CapturedRequest[];
  stop(): Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        url: request.url ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"id":"accepted"}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    requests,
    stop: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

function eventItems(envelope: string): Record<string, unknown>[] {
  const lines = envelope.trimEnd().split('\n');
  const events: Record<string, unknown>[] = [];
  for (let index = 1; index + 1 < lines.length; index += 2) {
    const itemHeader = JSON.parse(lines[index] ?? '{}') as { type?: unknown };
    if (itemHeader.type === 'event') {
      events.push(JSON.parse(lines[index + 1] ?? '{}') as Record<string, unknown>);
    }
  }
  return events;
}

function eventMessage(event: Record<string, unknown>): unknown {
  if (typeof event['message'] === 'string') return event['message'];
  const exception = event['exception'] as { values?: { value?: unknown }[] } | undefined;
  return exception?.values?.[0]?.value;
}
