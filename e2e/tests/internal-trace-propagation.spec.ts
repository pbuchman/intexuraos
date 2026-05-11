import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createInternalHttpClient } from '../../packages/internal-clients/src/shared/createInternalHttpClient.js';
import { runWithRequestId } from '../../packages/common-http/src/http/traceContext.js';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function readBody(request: IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    request.on('data', () => undefined);
    request.on('end', resolve);
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

describe('internal request trace propagation', () => {
  it('keeps the inbound X-Request-Id across two internal service hops', async () => {
    let secondHopRequestId: string | undefined;

    const downstream = createServer(async (request, response) => {
      await readBody(request);
      secondHopRequestId = request.headers['x-request-id']?.toString();
      sendJson(response, 200, { success: true, data: { observedRequestId: secondHopRequestId } });
    });

    downstream.listen(0, '127.0.0.1');
    await once(downstream, 'listening');
    const downstreamAddress = downstream.address();
    if (downstreamAddress === null || typeof downstreamAddress === 'string') {
      throw new Error('Downstream test server did not bind to a TCP port');
    }

    const downstreamClient = createInternalHttpClient({
      baseUrl: `http://127.0.0.1:${String(downstreamAddress.port)}`,
      token: 'secret',
      logger,
    });

    const upstream = createServer(async (request, response) => {
      const inboundRequestId = request.headers['x-request-id']?.toString();
      await readBody(request);

      const result = await runWithRequestId(inboundRequestId ?? '', async () =>
        downstreamClient.request<{ observedRequestId: string | undefined }>({
          path: '/internal/downstream',
          method: 'POST',
          body: { ok: true },
        })
      );

      sendJson(response, result.ok ? 200 : 502, {
        success: result.ok,
        ...(result.ok ? { data: result.value } : { error: result.error }),
      });
    });

    try {
      upstream.listen(0, '127.0.0.1');
      await once(upstream, 'listening');
      const upstreamAddress = upstream.address();
      if (upstreamAddress === null || typeof upstreamAddress === 'string') {
        throw new Error('Upstream test server did not bind to a TCP port');
      }

      const caller = createInternalHttpClient({
        baseUrl: `http://127.0.0.1:${String(upstreamAddress.port)}`,
        token: 'secret',
        logger,
      });

      const result = await caller.request<{ observedRequestId: string | undefined }>({
        path: '/internal/upstream',
        method: 'POST',
        body: { ok: true },
        requestId: 'req-two-hop-1',
      });

      expect(result).toEqual({
        ok: true,
        value: { observedRequestId: 'req-two-hop-1' },
      });
      expect(secondHopRequestId).toBe('req-two-hop-1');
    } finally {
      upstream.close();
      downstream.close();
    }
  });
});
