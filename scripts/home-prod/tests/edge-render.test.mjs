import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderer = new URL('../render-edge.mjs', import.meta.url);
function render(kind) {
  const result = spawnSync(process.execPath, [renderer.pathname, kind], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
test('isolated HTTP edge has only the home listener and shifted active upstreams', () => {
  const config = render('nginx');
  assert.deepEqual(
    [...config.matchAll(/listen ([^;]+);/g)].map((m) => m[1]),
    ['127.0.0.1:18080 default_server']
  );
  assert.ok(config.includes('/var/www/intexuraos-prod/web/current'));
  assert.ok(!config.includes('ssl_certificate'));
  assert.ok(!config.includes('127.0.0.1:811'));
  assert.ok(!config.includes('127.0.0.1:18116'));
  assert.ok(!config.includes('127.0.0.1:18135'));
  assert.ok(!config.includes('location ^~ /api/code/'));
  assert.ok(config.includes('proxy_set_header X-Forwarded-Proto https;'));
});
test('Lua keeps the existing policy with only its secret-file location changed', () => {
  const source = readFileSync(new URL('../nginx/jwt-verify.lua', import.meta.url), 'utf8');
  assert.equal(
    render('lua'),
    source.replace(
      '/etc/intexuraos/internal-auth-token',
      '/home/intexuraos-prod/.config/intexuraos/prod/internal-auth-token'
    )
  );
});
test('callback exceptions are exact, method-specific, and sanitize caller roles', () => {
  const config = render('nginx');
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
    const block = config.split(`location = /api/code/internal/${route} {`)[1]?.split('\n    }')[0];
    assert.ok(block, route);
    assert.match(block, /if \(\$request_method != (POST|PATCH)\)/);
    assert.match(block, /include .*callback-proxy.conf;/);
  }
  assert.match(
    config,
    /location ~ \^\/api\/code\/internal\/tasks\/\[A-Za-z0-9_-\]\+\/dispatch-metadata\$/
  );
  assert.match(render('callback-proxy'), /proxy_set_header X-Internal-Caller-Role "";/);
  assert.match(render('callback-proxy'), /proxy_set_header From "";/);
});
