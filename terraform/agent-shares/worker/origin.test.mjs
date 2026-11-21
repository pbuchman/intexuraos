import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareHandler } from '../origin/index.js';
import worker from './index.mjs';

test('the Worker serves and expires HTML through the Gen2 handler contract', async (t) => {
  const html = '<h1>Synthetic share</h1>\n';
  const cutoff = '2026-11-18T12:00:00Z';
  const expiry = Date.parse(cutoff);
  let now = expiry - 1;
  let mediaReads = 0;
  const origin = createShareHandler({
    bucket: 'offline-shares',
    now: () => now,
    fetch: async (input) => {
      const url = new URL(input);
      if (url.hostname === 'metadata.google.internal') {
        return Response.json({ access_token: 'synthetic-only' });
      }

      assert.equal(url.origin, 'https://storage.googleapis.com');
      assert.equal(url.pathname, '/storage/v1/b/offline-shares/o/synthetic-share.html');
      if (url.searchParams.get('alt') === 'media') {
        mediaReads += 1;
        return new Response(html);
      }

      return Response.json({
        customTime: cutoff,
        generation: '1',
        metageneration: '1',
        size: String(Buffer.byteLength(html)),
      });
    },
  });

  const functionOrigin = 'https://agent-shares-example.a.run.app';
  t.mock.method(globalThis, 'fetch', async (input, { method }) => {
    const url = new URL(input);
    assert.equal(url.origin, functionOrigin);
    const headers = new Headers();
    let body = null;
    const response = {
      statusCode: 0,
      setHeader: (key, value) => headers.set(key, value),
      end: (value) => {
        body = value ?? null;
      },
    };
    await origin({ method, originalUrl: url.pathname + url.search }, response);
    return new Response(body, { status: response.statusCode, headers });
  });

  const env = { FUNCTION_ORIGIN: functionOrigin };
  const request = new Request('https://share.intexuraos.cloud/synthetic-share.html?ignored=true');
  const active = await worker.fetch(request, env);
  assert.equal(active.status, 200);
  assert.equal(active.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(active.headers.get('content-security-policy'), /(?:^|; )sandbox allow-scripts$/);
  assert.equal(active.headers.get('cache-control'), 'no-store');
  assert.equal(active.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(active.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await active.text(), html);

  now = expiry;
  const expired = await worker.fetch(request, env);
  assert.equal(expired.status, 410);
  assert.equal(expired.headers.get('cache-control'), 'no-store');
  assert.equal(await expired.text(), 'Gone\n');
  assert.equal(mediaReads, 1);
});
