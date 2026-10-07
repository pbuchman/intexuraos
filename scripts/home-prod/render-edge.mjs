#!/usr/bin/env node
// Home ingress reuses the production route inventory and OIDC policy. The
// transformations deliberately fail when their source contract changes.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = '/etc/intexuraos-home-prod/nginx';
function source(name) {
  return readFileSync(new URL(`nginx/${name}`, import.meta.url), 'utf8');
}
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`Production edge contract changed: ${from}`);
  return text.replace(from, to);
}
const unavailable = `default_type application/json;
        add_header Cache-Control "no-store" always;
        add_header Retry-After "60" always;
        return 503 '{"success":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"Service temporarily unavailable"}}';`;
const callbacks = [
  ['webhooks/task-complete', 'POST', false],
  ['webhooks/task-event', 'POST', false],
  ['webhooks/compliance-report', 'POST', true],
  ['webhooks/usage-events', 'POST', true],
  ['logs', 'POST', false],
  ['turn-metrics', 'POST', false],
  ['code/heartbeat', 'POST', false],
  ['code-tasks/status', 'PATCH', true],
];
export function renderEdge(kind) {
  if (kind === 'lua')
    return replaceOnce(
      source('jwt-verify.lua'),
      '/etc/intexuraos/internal-auth-token',
      '/home/intexuraos-prod/.config/intexuraos/prod/internal-auth-token'
    );
  if (kind === 'callback-proxy')
    return `# Location-level proxy headers replace server inheritance: repeat the complete boundary.
proxy_http_version 1.1;
proxy_set_header Host intexuraos.cloud;
proxy_set_header X-Forwarded-Host intexuraos.cloud;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header Connection "";
proxy_set_header Authorization "";
proxy_set_header Cookie "";
proxy_set_header X-Internal-Caller-Role "";
proxy_set_header From "";
`;
  if (kind !== 'nginx') throw new Error('Usage: render-edge.mjs nginx|lua|callback-proxy');
  const original = source('intexuraos.conf');
  const upstreams = original
    .slice(0, original.indexOf('# Local-only maintenance proof surface.'))
    .replace(/upstream research_agent \{[^}]+\}\n/, '')
    .replace(/upstream message_digest_service \{[^}]+\}\n/, '')
    .replace(/127\.0\.0\.1:(81\d\d)/g, (_, port) => `127.0.0.1:${Number(port) + 10000}`);
  let server = original.slice(original.indexOf('server {\n    listen 443'));
  if (!server.startsWith('server {\n    listen 443'))
    throw new Error('Production HTTPS server missing');
  server = replaceOnce(
    server,
    '    listen 443 ssl http2 default_server;\n    listen [::]:443 ssl http2 default_server;',
    '    listen 127.0.0.1:18080 default_server;'
  );
  server = server.replace(/    ssl_[^;]+;\n/g, '');
  server = server
    .replaceAll('/var/www/intexuraos/web/current', '/var/www/intexuraos-prod/web/current')
    .replaceAll('/etc/nginx/lua/jwt-verify.lua', `${root}/jwt-verify.lua`);
  server = replaceOnce(
    server,
    'proxy_set_header X-Forwarded-Proto $scheme;',
    'proxy_set_header X-Forwarded-Proto https;'
  );
  server = replaceOnce(server, 'location ^~ /api/code/', 'location /api/code/');
  server = replaceOnce(
    server,
    '    location ~ ^/api/[a-z0-9-]+/internal(?:/|$) {',
    callbacks
      .map(
        ([
          route,
          method,
          token,
        ]) => `    # Backend verifies ${token ? 'the supplied internal token where required and ' : ''}the HMAC; never inject privileged roles.
    location = /api/code/internal/${route} {
        if ($request_method != ${method}) { return 405; }
        include ${root}/callback-proxy.conf;
        proxy_set_header X-Internal-Auth ${token ? '$http_x_internal_auth' : '""'};
        proxy_pass http://code_agent/internal/${route};
    }`
      )
      .join('\n\n') +
      `

    # Recovery metadata is GET-only and backend-authenticated by its supplied token.
    location ~ ^/api/code/internal/tasks/[A-Za-z0-9_-]+/dispatch-metadata$ {
        if ($request_method != GET) { return 405; }
        include ${root}/callback-proxy.conf;
        proxy_set_header X-Internal-Auth $http_x_internal_auth;
        rewrite ^/api/code(/internal/.*)$ $1 break;
        proxy_pass http://code_agent;
    }

    location ~ ^/api/[a-z0-9-]+/internal(?:/|$) {`
  );
  server = replaceOnce(
    server,
    '    location = /api/research { proxy_pass http://research_agent/; }\n    location /api/research/ { proxy_pass http://research_agent/; }',
    `    location = /api/research { ${unavailable} }
    location /api/research/ { ${unavailable} }`
  );
  server = replaceOnce(
    server,
    '    include /etc/nginx/intexuraos-message-digests-public.conf;',
    `    location = /api/message-digests { ${unavailable} }
    location /api/message-digests/ { ${unavailable} }`
  );
  for (const [route, upstream] of [
    ['llm', 'research_agent'],
    ['message-digests', 'message_digest_service'],
  ]) {
    server = replaceOnce(
      server,
      `    location /internal/${route}/ { access_by_lua_file ${root}/jwt-verify.lua; proxy_pass http://${upstream}; }`,
      `    location = /internal/${route} { ${unavailable} }
    location /internal/${route}/ { ${unavailable} }`
    );
  }
  // GCS locations override proxy headers, so the inherited caller-role scrub must
  // be repeated. Never forward browser credentials or privileged identity there.
  server = server.replaceAll(
    '        proxy_set_header X-Internal-Auth "";',
    '        proxy_set_header X-Internal-Auth "";\n        proxy_set_header X-Internal-Caller-Role "";'
  );
  server = replaceOnce(
    server,
    '    if ($host != "intexuraos.cloud") {',
    `    # Reject double decoding and path separator ambiguity before location dispatch.
    if ($ambiguous_api_path) { return 400; }
    absolute_redirect off;
    if ($host != "intexuraos.cloud") {`
  );
  return `# Generated by scripts/home-prod/render-edge.mjs. No shared nginx includes.
load_module /usr/lib/nginx/modules/ndk_http_module.so;
load_module /usr/lib/nginx/modules/ngx_http_lua_module.so;
worker_processes auto;
pid /run/intexuraos-home-prod-nginx/nginx.pid;
error_log /var/log/intexuraos-home-prod-nginx/error.log warn;
events { worker_connections 1024; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    server_tokens off;
    variables_hash_max_size 2048;
    variables_hash_bucket_size 128;
    lua_package_path "/usr/local/share/lua/5.1/?.lua;/usr/local/share/lua/5.1/?/init.lua;;";
    log_format edge '$remote_addr $request_method $uri $status';
    access_log /var/log/intexuraos-home-prod-nginx/access.log edge;
    client_body_temp_path /var/lib/intexuraos-home-prod-nginx/client;
    proxy_temp_path /var/lib/intexuraos-home-prod-nginx/proxy;
    fastcgi_temp_path /var/lib/intexuraos-home-prod-nginx/fastcgi;
    uwsgi_temp_path /var/lib/intexuraos-home-prod-nginx/uwsgi;
    scgi_temp_path /var/lib/intexuraos-home-prod-nginx/scgi;
    map $request_uri $ambiguous_api_path {
        default 0;
        ~*^/api/[^?]*(?:%2f|%5c|%25|%2e|//|/\\.\\.) 1;
    }
${upstreams}\n${server}\n}\n`;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.stdout.write(renderEdge(process.argv[2]));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
