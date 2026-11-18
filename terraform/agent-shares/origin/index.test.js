import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareHandler, serveShare } from './index.js';

const CUTOFF = '2026-11-18T13:00:00Z';
const CUTOFF_MS = Date.parse(CUTOFF);
const BUCKET = 'private-share-test';
const GENERATION = '9223372036854775007';
const MAX_SHARE_BYTES = 16 * 1024 * 1024;

function token() {
  return Response.json({ access_token: 'synthetic-access-token' });
}

function metadata(fields = {}) {
  return Response.json({
    customTime: CUTOFF,
    generation: GENERATION,
    metageneration: '7',
    size: '100',
    ...fields,
  });
}

function captureResponse() {
  return {
    headers: new Headers(),
    setHeader(name, value) {
      this.headers.set(name, value);
    },
    end(body) {
      assert.equal(this.ended, undefined);
      this.ended = true;
      this.body = body;
    },
  };
}

function setup(responses = [], options = {}) {
  const calls = [];
  const handler = createShareHandler({
    bucket: BUCKET,
    now: () => CUTOFF_MS - 1,
    fetch: async (url, init) => {
      const response = responses[calls.length];
      calls.push({ url: new URL(url), init });
      return typeof response === 'function' ? response() : response;
    },
    ...options,
  });
  return {
    calls,
    async request(method = 'GET', url = '/report-1.html', extras = {}) {
      const response = captureResponse();
      await handler({ method, url, ...extras }, response);
      assert.equal(response.ended, true);
      return response;
    },
  };
}

function assertSafetyHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(
    response.headers.get('content-security-policy'),
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts"
  );
}

test('exports a Gen2 handler that rejects unmatched routes without going upstream', async () => {
  const response = captureResponse();
  await serveShare({ method: 'GET', url: '/health' }, response);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body, 'Not Found\n');
  assertSafetyHeaders(response);
});

test('gets live HTML with projected headers and exact generation conditions', async () => {
  const html = '<!doctype html><script>document.title="Synthetic report"</script>';
  const media = new Response(html, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment',
      'cache-control': 'public, max-age=3600',
      'set-cookie': 'upstream-cookie=omit',
      'access-control-allow-origin': '*',
      etag: 'upstream-tag',
    },
  });
  const origin = setup([token(), metadata(), media]);
  const response = await origin.request('GET', '/report-1.html', {
    headers: { 'if-none-match': '"upstream-tag"', range: 'bytes=1-2' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, Buffer.from(html));
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  for (const name of ['content-disposition', 'set-cookie', 'access-control-allow-origin', 'etag']) {
    assert.equal(response.headers.has(name), false, name);
  }
  assertSafetyHeaders(response);

  const [tokenCall, metadataCall, mediaCall] = origin.calls;
  assert.equal(origin.calls.length, 3);
  assert.equal(
    tokenCall.url.href,
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
  );
  assert.deepEqual(tokenCall.init.headers, { 'Metadata-Flavor': 'Google' });
  for (const call of [metadataCall, mediaCall]) {
    assert.equal(call.url.origin, 'https://storage.googleapis.com');
    assert.equal(call.url.pathname, `/storage/v1/b/${BUCKET}/o/report-1.html`);
    assert.deepEqual(call.init.headers, { Authorization: 'Bearer synthetic-access-token' });
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.cache, 'no-store');
  }
  assert.deepEqual(Object.fromEntries(metadataCall.url.searchParams), {
    fields: 'customTime,generation,metageneration,size',
  });
  assert.deepEqual(Object.fromEntries(mediaCall.url.searchParams), {
    alt: 'media',
    ifGenerationMatch: GENERATION,
    ifMetagenerationMatch: '7',
  });
});

test('serves Markdown bytes and uses only fresh metadata for HEAD', async () => {
  const markdown = '# Synthetic report\n\nZażółć gęślą jaźń.\n';
  const origin = setup([token(), metadata(), new Response(markdown), token(), metadata()]);
  const path = `/${'a'.repeat(128)}.md`;

  const get = await origin.request('GET', path);
  const head = await origin.request('HEAD', path);

  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.body, Buffer.from(markdown));
  assert.equal(get.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
  assert.deepEqual([...head.headers], [...get.headers]);
  assert.equal(origin.calls.length, 5);
  assert.equal(origin.calls[4].url.searchParams.has('alt'), false);
});

test('rejects methods, encoded paths, and routes outside the flat share namespace', async () => {
  const origin = setup();
  for (const method of ['POST', 'OPTIONS', 'PUT']) {
    const response = await origin.request(method);
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assertSafetyHeaders(response);
  }

  for (const path of [
    '/',
    '/sub/report.html',
    '/sub/../report.html',
    '/report%2ehtml',
    '/report%2f1.html',
    '/%72eport.html',
    '/report.html?generation=1',
    '/report.html#anchor',
    '/report.html\n',
    '//report.html',
    '/report.html/',
    '/Report.html',
    '/report.HTML',
    '/report.txt',
    '/-report.html',
    '/report-.html',
    '/report--1.html',
    `/${'a'.repeat(129)}.html`,
  ]) {
    const response = await origin.request('HEAD', '/report.html', { originalUrl: path });
    assert.equal(response.statusCode, 404, JSON.stringify(path));
    assert.equal(response.body, undefined);
    assertSafetyHeaders(response);
  }
  assert.equal(origin.calls.length, 0);
});

test('returns 410 for GET and HEAD at the exact cutoff and afterward', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const now of [CUTOFF_MS, CUTOFF_MS + 1]) {
      const origin = setup([token(), metadata()], { now: () => now });
      const response = await origin.request(method);
      assert.equal(response.statusCode, 410);
      assert.equal(response.body, method === 'GET' ? 'Gone\n' : undefined);
      assert.equal(origin.calls.length, 2);
      assertSafetyHeaders(response);
    }
  }
});

test('preserves a sub-millisecond cutoff through the first clock tick at or after it', async () => {
  const fractional = '2026-11-18T13:00:00.000000001Z';
  const origin = setup(
    [token(), metadata({ customTime: fractional }), token(), metadata({ customTime: fractional })],
    { now: () => (origin.calls.length === 2 ? CUTOFF_MS : CUTOFF_MS + 1) }
  );
  assert.equal((await origin.request('HEAD')).statusCode, 200);
  assert.equal((await origin.request('HEAD')).statusCode, 410);
});

test('returns 410 if a stream crosses the cutoff after some bytes have arrived', async () => {
  let time = CUTOFF_MS - 1;
  let reads = 0;
  const media = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          reads += 1;
          controller.enqueue(Buffer.from('unreleased share content'));
          if (reads === 2) {
            time = CUTOFF_MS;
            controller.close();
          }
        },
      })
    );
  const origin = setup([token(), metadata(), media], { now: () => time });
  const response = await origin.request();
  assert.equal(reads, 2);
  assert.equal(response.statusCode, 410);
  assert.equal(response.body, 'Gone\n');
  assertSafetyHeaders(response);
});

test('serves permanent shares without system Custom-Time', async () => {
  const html = '<!doctype html><title>Permanent report</title>';
  const permanent = { customTime: undefined, metadata: { customTime: CUTOFF } };
  const origin = setup(
    [token(), metadata(permanent), new Response(html), token(), metadata(permanent)],
    { now: () => CUTOFF_MS + 1 }
  );
  const get = await origin.request();
  const head = await origin.request('HEAD');
  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.body, Buffer.from(html));
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
  assert.deepEqual([...head.headers], [...get.headers]);
  assertSafetyHeaders(get);
  assert.deepEqual(Object.fromEntries(origin.calls[2].url.searchParams), {
    alt: 'media',
    ifGenerationMatch: GENERATION,
    ifMetagenerationMatch: '7',
  });
});

test('rejects invalid system Custom-Time', async () => {
  for (const badTime of [null, 0, 'tomorrow', '2027-02-30T00:00:00Z', CUTOFF + '\n']) {
    const origin = setup([
      token(),
      metadata({ customTime: badTime, metadata: { customTime: CUTOFF } }),
    ]);
    const response = await origin.request();
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, 'Not Found\n');
    assert.equal(origin.calls.length, 2);
    assertSafetyHeaders(response);
  }
});

test('returns 404 for a missing object in metadata or a deletion before media download', async () => {
  for (const metadataAvailable of [true, false]) {
    const notFound = new Response('private bucket and object details', { status: 404 });
    const origin = setup(metadataAvailable ? [token(), metadata(), notFound] : [token(), notFound]);
    const response = await origin.request();
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, 'Not Found\n');
    assertSafetyHeaders(response);
  }
});

test('fails closed for generation conflicts, malformed metadata and upstream failures', async () => {
  const internalDetails = 'synthetic private diagnostic';
  const cases = [
    [new Response(internalDetails, { status: 500 })],
    [Response.json({ error: internalDetails })],
    [token(), new Response(internalDetails, { status: 403 })],
    [token(), metadata({ generation: 123 })],
    [token(), metadata({ metageneration: '0' })],
    [token(), metadata(), new Response(internalDetails, { status: 412 })],
    [token(), metadata(), new Response(internalDetails, { status: 206 })],
    [
      token(),
      metadata(),
      () => {
        throw new Error(internalDetails);
      },
    ],
  ];
  for (const replies of cases) {
    const origin = setup(replies);
    const response = await origin.request();
    assert.equal(response.statusCode, 503);
    assert.equal(response.body, 'Service Unavailable\n');
    assertSafetyHeaders(response);
  }
});

test('rejects oversized stored objects without requesting media', async () => {
  const origin = setup([token(), metadata({ size: String(MAX_SHARE_BYTES + 1) })]);
  const response = await origin.request();
  assert.equal(response.statusCode, 404);
  assert.equal(response.body, 'Not Found\n');
  assert.equal(origin.calls.length, 2);
});

test('cancels media if decoded bytes exceed the cap even when stored bytes fit', async () => {
  let cancelled = false;
  const media = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_SHARE_BYTES / 2));
      },
      cancel() {
        cancelled = true;
      },
    })
  );
  const origin = setup([token(), metadata({ size: '100' }), media]);
  const response = await origin.request();
  assert.equal(response.statusCode, 404);
  assert.equal(response.body, 'Not Found\n');
  assert.equal(cancelled, true);
});
