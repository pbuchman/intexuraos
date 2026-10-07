// Runs real nginx routing and real lua-resty-openidc JWT verification in a
// throwaway container. Only the downstream services and Google discovery/JWKS
// endpoint are replaced with local fixtures; the test makes no external requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { renderEdge } from '../render-edge.mjs';
const image = 'intexuraos-home-prod-edge-test';
const directory = mkdtempSync(join(tmpdir(), 'home-prod-edge-'));
const name = `home-prod-edge-test-${process.pid}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const scheduler = 'intexuraos-scheduler-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
const claims = {
  iss: 'https://accounts.google.com',
  aud: 'https://intexuraos.cloud',
  email: scheduler,
};
function jwt(overrides = {}, key = privateKey) {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const token = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })}.${encode({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...claims, ...overrides })}`;
  return `${token}.${sign('RSA-SHA256', Buffer.from(token), key).toString('base64url')}`;
}
function request(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: port,
        path,
        method,
        headers: { Host: 'intexuraos.cloud', ...headers },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            json: () => JSON.parse(body),
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}
let port;
const write = (file, body) => writeFileSync(join(directory, file), body, { mode: 0o644 });
chmodSync(directory, 0o755);
let config = renderEdge('nginx')
  .replace(/^load_module .*\n/gm, '')
  .replace('worker_processes auto;', 'worker_processes 1;')
  .replace('/run/intexuraos-home-prod-nginx/nginx.pid', '/tmp/nginx.pid')
  .replaceAll('/var/log/intexuraos-home-prod-nginx/', '/tmp/')
  .replaceAll('/var/lib/intexuraos-home-prod-nginx/', '/tmp/')
  .replace('/etc/nginx/mime.types', '/usr/local/openresty/nginx/conf/mime.types')
  .replaceAll('/etc/intexuraos-home-prod/nginx', '/test')
  .replaceAll('/var/www/intexuraos-prod/web/current', '/test')
  .replaceAll('127.0.0.1:18080', '0.0.0.0:18080')
  .replace(/127\.0\.0\.1:181\d\d/g, '127.0.0.1:19000');
config =
  config.slice(0, config.lastIndexOf('}')) +
  `
server {
 listen 127.0.0.1:19000;
 location / {
  default_type application/json;
  content_by_lua_block {
   local json = require('cjson')
   local uri = ngx.var.uri
   if uri == '/discovery' or uri == '/jwks' then
    local f = assert(io.open('/test' .. uri .. '.json'))
    ngx.print(f:read('*a')); f:close(); return
   end
   local headers = ngx.req.get_headers()
   if uri:find('/dispatch%-metadata$') or uri == '/internal/webhooks/compliance-report' or uri == '/internal/webhooks/usage-events' then
    if headers['x-internal-auth'] ~= 'test-backend-token' then ngx.status = 401 end
   end
   if uri:find('^/internal/') and not uri:find('/dispatch%-metadata$') then
    -- Routing/header contract stub. Actual application HMAC validation is covered
    -- by code-agent's webhook route tests; JWT validation above is not mocked.
    if headers['x-internal-auth'] ~= 'test-backend-token' and headers['x-request-signature'] ~= 'test-signature' then ngx.status = 401 end
   end
   ngx.say(json.encode({uri=uri,headers=headers}))
  }
 }
}
}\n`;
write('nginx.conf', config);
write('callback-proxy.conf', renderEdge('callback-proxy'));
write(
  'jwt-verify.lua',
  renderEdge('lua')
    .replace(
      '/home/intexuraos-prod/.config/intexuraos/prod/internal-auth-token',
      '/test/internal-auth-token'
    )
    .replace(
      'https://accounts.google.com/.well-known/openid-configuration',
      'http://127.0.0.1:19000/discovery'
    )
);
write('internal-auth-token', 'test-backend-token');
write('index.html', 'test SPA');
write(
  'discovery.json',
  JSON.stringify({ issuer: claims.iss, jwks_uri: 'http://127.0.0.1:19000/jwks' })
);
write('jwks.json', JSON.stringify({ keys: [jwk] }));
try {
  execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--user',
      '10001:10001',
      '--rm',
      '--name',
      name,
      '--network',
      'bridge',
      '--publish',
      '127.0.0.1::18080',
      '--mount',
      `type=bind,src=${directory},dst=/test,readonly`,
      image,
      'nginx',
      '-c',
      '/test/nginx.conf',
      '-g',
      'daemon off;',
    ],
    { stdio: 'pipe' }
  );
  port = Number(
    execFileSync('docker', ['port', name, '18080'], { encoding: 'utf8' }).trim().split(':').at(-1)
  );
  for (let i = 0; i < 50; i++) {
    try {
      await request('/healthz');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await test('real nginx denies every internal API alias except exact backend-authenticated callbacks', async () => {
    const aliases = [
      'user',
      'notion',
      'whatsapp',
      'notifications',
      'research',
      'fishing-assistant',
      'images',
      'notes',
      'settings',
      'bookmarks',
      'calendar',
      'linear',
      'web',
      'code',
      'hellscript-agent',
      'llm-usage',
      'intex-agent',
      'message-digests',
    ];
    for (const alias of aliases)
      for (const suffix of ['/internal', '/internal/', '/internal/secret', '/%69nternal/secret'])
        assert.equal((await request(`/api/${alias}${suffix}`)).status, 404, `${alias}${suffix}`);
    for (const path of [
      '/api/code/internal%2fsecret',
      '/api/code/%2569nternal/secret',
      '/api/code//internal/secret',
      '/api/code/foo/%2e%2e/internal/secret',
    ])
      assert.equal((await request(path)).status, 400, path);
  });
  await test('callbacks preserve required auth/signature headers, scrub roles, and enforce exact methods', async () => {
    for (const route of [
      'webhooks/task-complete',
      'webhooks/task-event',
      'webhooks/compliance-report',
      'webhooks/usage-events',
      'logs',
      'turn-metrics',
      'code/heartbeat',
      'code-tasks/status',
    ]) {
      const method = route === 'code-tasks/status' ? 'PATCH' : 'POST';
      const path = `/api/code/internal/${route}`;
      const result = await request(path, {
        method,
        headers: {
          'X-Request-Signature': 'test-signature',
          'X-Request-Timestamp': '123',
          'X-Internal-Auth': 'test-backend-token',
          'X-Internal-Caller-Role': 'forged',
          From: 'forged',
          Authorization: 'Bearer browser',
          Cookie: 'secret',
        },
      });
      assert.equal(result.status, 200, route);
      const h = result.json().headers;
      assert.equal(h['x-request-signature'], 'test-signature');
      assert.equal(h['x-request-timestamp'], '123');
      for (const key of ['x-internal-caller-role', 'from', 'authorization', 'cookie'])
        assert.equal(h[key], undefined, key);
      assert.equal(h['x-forwarded-proto'], 'https');
      assert.equal((await request(path)).status, 405);
      assert.equal((await request(`${path}/extra`, { method })).status, 404);
    }
    for (const path of [
      '/api/code/internal/tasks/task_123/dispatch-metadata',
      '/api/code/internal/webhooks/compliance-report',
      '/api/code/internal/webhooks/usage-events',
    ]) {
      const method = path.includes('/tasks/') ? 'GET' : 'POST';
      assert.equal(
        (
          await request(path, {
            method,
            headers: { 'X-Internal-Auth': 'invalid', 'X-Request-Signature': 'test-signature' },
          })
        ).status,
        401
      );
      assert.equal(
        (
          await request(path, {
            method,
            headers: {
              'X-Internal-Auth': 'test-backend-token',
              'X-Request-Signature': 'test-signature',
            },
          })
        ).status,
        200
      );
    }
    assert.equal(
      (await request('/api/code/internal/tasks/task_123/dispatch-metadata', { method: 'POST' }))
        .status,
      405
    );
  });
  await test('excluded services have deterministic JSON 503 responses', async () => {
    for (const path of [
      '/api/research',
      '/api/research/health',
      '/api/message-digests',
      '/api/message-digests/health',
      '/internal/llm/run',
      '/internal/message-digests/pubsub/run',
    ]) {
      const r = await request(path);
      assert.equal(r.status, 503, path);
      assert.deepEqual(r.json(), {
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
      });
      assert.equal(r.headers['retry-after'], '60');
    }
  });
  await test('public browser/OAuth headers survive but privileged headers cannot be forged', async () => {
    for (const path of ['/api/user/me', '/oauth/connections/google/callback']) {
      const r = await request(path, {
        headers: {
          Authorization: 'Bearer browser',
          Cookie: 'session=value',
          'X-Internal-Auth': 'forged',
          'X-Internal-Caller-Role': 'forged',
          From: 'forged',
          'X-Forwarded-Proto': 'http',
        },
      });
      assert.equal(r.status, 200);
      const h = r.json().headers;
      assert.equal(h.authorization, 'Bearer browser');
      assert.equal(h.cookie, 'session=value');
      assert.equal(h['x-forwarded-proto'], 'https');
      for (const key of ['x-internal-auth', 'x-internal-caller-role', 'from'])
        assert.equal(h[key], undefined);
    }
  });
  await test('real OIDC signatures, expiry, audience, issuer and service-account allowlists are enforced', async () => {
    const path = '/internal/calendar/process';
    assert.equal((await request(path)).status, 401);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    for (const token of [
      'invalid',
      jwt({}, other.privateKey),
      jwt({ exp: 1 }),
      jwt({ aud: 'https://other.example' }),
      jwt({ iss: 'https://other.example' }),
    ])
      assert.equal(
        (await request(path, { headers: { Authorization: `Bearer ${token}` } })).status,
        401
      );
    assert.equal(
      (
        await request(path, {
          headers: { Authorization: `Bearer ${jwt({ email: 'other@example.com' })}` },
        })
      ).status,
      403
    );
    const r = await request(path, {
      headers: {
        Authorization: `Bearer ${jwt()}`,
        'X-Internal-Caller-Role': 'forged',
        From: 'forged',
        Cookie: 'secret',
      },
    });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json().headers['x-internal-auth'], 'test-backend-token');
    for (const key of ['authorization', 'cookie', 'x-internal-caller-role', 'from'])
      assert.equal(r.json().headers[key], undefined);
  });
  await test('route-scoped identity and HTTP methods gate privileged role/From injection', async () => {
    const email = 'intexuraos-intex-agent-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com';
    const path = '/internal/intex-agent/messages';
    const headers = { Authorization: `Bearer ${jwt({ email })}` };
    assert.equal((await request(path, { headers })).status, 403);
    assert.equal(
      (await request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt()}` } }))
        .status,
      403
    );
    const r = await request(path, { method: 'POST', headers });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json().headers['x-internal-caller-role'], 'intex_message_ingest_pubsub');
    assert.equal(r.json().headers.from, 'noreply@google.com');
    assert.equal(
      (
        await request('/internal/evals/intex-agent/test-runs/id/cleanup', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${jwt({ email: 'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com' })}`,
          },
        })
      ).status,
      403
    );
  });
} finally {
  try {
    execFileSync('docker', ['logs', name], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch {}
  try {
    execFileSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
