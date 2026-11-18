import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from './index.mjs';

const HOST = 'https://share.intexuraos.cloud';
const ORIGIN = 'https://agent-shares-example.a.run.app';
const ENV = { FUNCTION_ORIGIN: ORIGIN };
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts";
const HTML = 'text/html; charset=utf-8';
const MARKDOWN = 'text/markdown; charset=utf-8';

function originResponse(body, type = HTML, extraHeaders = {}) {
  return new Response(body, {
    headers: { 'content-type': type, 'content-security-policy': CSP, ...extraHeaders },
  });
}

function assertResponse(response, status, contentType) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-type'), contentType);
  assert.ok(response.headers.get('content-security-policy'));
}

test('GET makes a fresh subrequest to the fixed origin and streams the HTML bytes', async (t) => {
  const body = '<style>h1 {color: red}</style><h1>Example</h1>';
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    originResponse(body, HTML, {
      'cache-control': 'public, max-age=1000',
      'cdn-cache-control': 'public, max-age=1000',
      'set-cookie': 'origin=secret',
      'content-disposition': 'attachment',
      'access-control-allow-origin': '*',
      etag: '"origin-validator"',
      link: '</unexpected-script>; rel=preload',
    })
  );
  const request = new Request(`${HOST}/weekly-report.html?url=https://other.example`, {
    headers: {
      authorization: 'Bearer synthetic',
      cookie: 'session=synthetic',
      'if-none-match': '"synthetic"',
      range: 'bytes=0-15',
      host: 'other.example',
      'cf-access-jwt-assertion': 'synthetic',
      'x-forwarded-host': 'other.example',
      'accept-encoding': 'gzip',
    },
  });

  const response = await worker.fetch(request, ENV);

  assertResponse(response, 200, HTML);
  assert.equal(response.headers.get('content-security-policy'), CSP);
  assert.equal(await response.text(), body);
  assert.deepEqual(
    [...response.headers.keys()],
    [
      'cache-control',
      'content-security-policy',
      'content-type',
      'referrer-policy',
      'x-content-type-options',
    ]
  );
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(fetch.mock.calls[0].arguments, [
    `${ORIGIN}/weekly-report.html`,
    {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      headers: { 'accept-encoding': 'identity' },
    },
  ]);
});

test('Markdown downloads as text/markdown and HEAD returns headers only', async (t) => {
  const body = '# Example\n';
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, { method }) =>
    originResponse(method === 'HEAD' ? null : body, MARKDOWN, {
      'content-length': String(body.length),
      'content-disposition': 'inline; filename="ignore-upstream.md"',
    })
  );
  const path = `/${'a'.repeat(128)}.md`;

  const get = await worker.fetch(new Request(`${HOST}${path}`), ENV);
  assertResponse(get, 200, MARKDOWN);
  assert.equal(get.headers.get('content-disposition'), 'attachment');
  assert.equal(await get.text(), body);

  const head = await worker.fetch(new Request(`${HOST}${path}?q=ignored`, { method: 'HEAD' }), ENV);
  assertResponse(head, 200, MARKDOWN);
  assert.equal(head.headers.get('content-disposition'), 'attachment');
  assert.equal(head.headers.get('content-length'), String(body.length));
  assert.equal(head.body, null);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(fetch.mock.calls[1].arguments[0], `${ORIGIN}${path}`);
  assert.equal(fetch.mock.calls[1].arguments[1].method, 'HEAD');
});

test('unexpected public URLs and methods never hit the origin', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('unexpected fetch'));
  const invalidUrls = [
    `${HOST}/`,
    `${HOST}/hello`,
    `${HOST}/Hello.html`,
    `${HOST}/hello.HTML`,
    `${HOST}/hello_world.md`,
    `${HOST}/a--b.html`,
    `${HOST}/-hello.md`,
    `${HOST}/hello-.html`,
    `${HOST}/${'a'.repeat(129)}.md`,
    `${HOST}/folder/hello.html`,
    `${HOST}//hello.html`,
    `${HOST}/./hello.html`,
    `${HOST}/folder/../hello.html`,
    `${HOST}/folder\\..\\hello.html`,
    `${HOST}/%2e/hello.html`,
    `${HOST}/%68ello.html`,
    `${HOST}/folder%2fhello.html`,
    `${HOST}/hello.html/`,
    `${HOST}/hello.html#fragment`,
    `${HOST}/hello.html\n`,
    'https://intexuraos.cloud/hello.html',
    `${HOST}.example/hello.html`,
    'http://share.intexuraos.cloud/hello.html',
    'https://any.workers.dev/hello.html',
  ];

  for (const url of invalidUrls) {
    // A Request constructor normalizes dot segments before the handler receives url.
    const response = await worker.fetch({ url, method: 'HEAD' }, ENV);
    assertResponse(response, 404, 'text/plain; charset=utf-8');
    assert.equal(response.body, null);
  }

  const request = new Request(`${HOST}/weekly-report.md`, { method: 'POST' });
  const response = await worker.fetch(request, ENV);
  assertResponse(response, 405, 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  assert.equal(fetch.mock.callCount(), 0);
});

test('invalid origin bindings fail closed before fetch', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('unexpected fetch'));
  const request = new Request(`${HOST}/weekly-report.md`);

  for (const value of [
    undefined,
    '',
    'https://run.app',
    'https://foo.run.app.evil',
    'http://foo.run.app',
    'https://foo.run.app:443',
    'https://foo.run.app//',
    'https://foo.run.app/content',
    'https://foo.run.app/?origin=elsewhere',
    'https://foo.run.app#fragment',
    'https://x@foo.run.app',
    'https://foo.run.app@evil.example',
    `${ORIGIN}\n`,
    'https://-foo.run.app',
  ]) {
    assertResponse(
      await worker.fetch(request, { FUNCTION_ORIGIN: value }),
      502,
      'text/plain; charset=utf-8'
    );
  }

  assert.equal(fetch.mock.callCount(), 0);
});

test('the edge keeps absent and expired outcomes distinct and discards their origin bodies', async (t) => {
  for (const [status, message] of [
    [404, 'Not found\n'],
    [410, 'Gone\n'],
  ]) {
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response('internal origin response', {
          status,
          headers: { 'set-cookie': 'invalid=true', 'content-type': HTML },
        })
    );

    const get = await worker.fetch(new Request(`${HOST}/weekly-report.html`), ENV);
    assertResponse(get, status, 'text/plain; charset=utf-8');
    assert.equal(await get.text(), message);
    assert.equal(get.headers.get('set-cookie'), null);

    const head = await worker.fetch(
      new Request(`${HOST}/weekly-report.html`, { method: 'HEAD' }),
      ENV
    );
    assertResponse(head, status, 'text/plain; charset=utf-8');
    assert.equal(head.body, null);
    fetch.mock.restore();
  }
});

test('unexpected origin responses and fetch failures return generic no-store 502s', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {});
  const request = new Request(`${HOST}/weekly-report.html`);
  const invalidResponses = [
    new Response('redirect', { status: 301, headers: { location: 'https://elsewhere.example' } }),
    new Response(null, { status: 304 }),
    new Response('partial', { status: 206, headers: { 'content-range': 'bytes 0-7/200' } }),
    new Response('network error', { status: 503 }),
    originResponse('wrong type', MARKDOWN),
    originResponse('wrong encoding', HTML, { 'content-encoding': 'gzip' }),
    originResponse('wrong length', HTML, { 'content-length': 'invalid' }),
    originResponse('wrong policy', HTML, { 'content-security-policy': 'default-src *' }),
    new Response('missing policy', { headers: { 'content-type': HTML } }),
  ];

  for (const invalid of invalidResponses) {
    fetch.mock.mockImplementationOnce(async () => invalid);
    const response = await worker.fetch(request, ENV);
    assertResponse(response, 502, 'text/plain; charset=utf-8');
    assert.equal(await response.text(), 'Bad gateway\n');
    assert.equal(response.headers.get('location'), null);
  }

  fetch.mock.mockImplementationOnce(async () => {
    throw new Error('synthetic network error');
  });
  const response = await worker.fetch(new Request(request, { method: 'HEAD' }), ENV);
  assertResponse(response, 502, 'text/plain; charset=utf-8');
  assert.equal(response.body, null);
  assert.equal(fetch.mock.callCount(), invalidResponses.length + 1);
});
