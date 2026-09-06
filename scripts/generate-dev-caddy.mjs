#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const edgeDirectory = resolve(moduleDirectory, '..', 'config', 'edge');
const accessManifest = JSON.parse(readFileSync(resolve(edgeDirectory, 'dev-access.json'), 'utf8'));
const profileManifest = JSON.parse(
  readFileSync(resolve(edgeDirectory, 'dev-hibernation.json'), 'utf8')
);

const EXPECTED_PROFILES = ['active-pre-cutover', 'active-post-cutover', 'draining', 'hibernated'];
const MATRIX_PATH_PREFIX = '/api/matrix-outbound';
const MATRIX_PORT = 8099;
const DEV_ACCESS_LOG = '/var/log/caddy/intexuraos-dev-access.json';
const EXPECTED_DRAINING_CALLBACKS = [
  {
    guard: 'per-task-hmac-timestamp',
    method: 'POST',
    path: '/api/code/internal/webhooks/task-complete',
    port: 8128,
    stripPrefix: '/api/code',
  },
  {
    guard: 'per-task-hmac-timestamp',
    method: 'POST',
    path: '/api/code/internal/logs',
    port: 8128,
    stripPrefix: '/api/code',
  },
  {
    guard: 'per-task-hmac-timestamp',
    method: 'POST',
    path: '/api/code/internal/turn-metrics',
    port: 8128,
    stripPrefix: '/api/code',
  },
  {
    guard: 'per-task-hmac-timestamp',
    method: 'POST',
    path: '/api/code/internal/webhooks/task-event',
    port: 8128,
    stripPrefix: '/api/code',
  },
  {
    guard: 'per-task-hmac-timestamp-internal-auth',
    method: 'POST',
    path: '/api/code/internal/webhooks/compliance-report',
    port: 8128,
    stripPrefix: '/api/code',
  },
  {
    guard: 'task-or-orchestrator-hmac',
    method: 'PATCH',
    path: '/api/code/internal/code-tasks/status',
    port: 8128,
    stripPrefix: '/api/code',
  },
];

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has an invalid shape`);
  }
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error(`${label} must match the exact tracked allowlist`);
  }
}

function assertPort(port, label) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} port is invalid`);
  }
}

function validateAccessManifest() {
  exactKeys(
    accessManifest,
    [
      'browserIdentity',
      'browserRoutes',
      'host',
      'machineRoutes',
      'schemaVersion',
      'serviceRoutes',
      'staticRoot',
    ],
    'DEV edge manifest'
  );
  if (accessManifest.schemaVersion !== 1 || accessManifest.host !== 'dev.intexuraos.cloud') {
    throw new Error('DEV edge manifest identity is invalid');
  }
  if (accessManifest.browserIdentity !== 'kontakt@pbuchman.com') {
    throw new Error('DEV browser identity is invalid');
  }
  if (!/^\/[-A-Za-z0-9_/]+$/u.test(accessManifest.staticRoot)) {
    throw new Error('DEV static root is invalid');
  }
  if (!Array.isArray(accessManifest.machineRoutes) || accessManifest.machineRoutes.length === 0) {
    throw new Error('DEV machine routes must be a non-empty array');
  }
  if (!Array.isArray(accessManifest.browserRoutes) || accessManifest.browserRoutes.length === 0) {
    throw new Error('DEV browser routes must be a non-empty array');
  }

  const machineKeys = new Set();
  for (const route of accessManifest.machineRoutes) {
    exactKeys(route, ['guard', 'method', 'path', 'port', 'stripPrefix'], 'machine route');
    if (!/^(?:POST|PATCH)$/u.test(route.method) || !/^\/[-A-Za-z0-9_/]+$/u.test(route.path)) {
      throw new Error('Machine route method or path is invalid');
    }
    if (/[{}*]/u.test(route.path) || !route.path.startsWith(`${route.stripPrefix}/`)) {
      throw new Error('Machine route must use one literal path below its strip prefix');
    }
    assertPort(route.port, 'Machine route');
    const key = `${route.method} ${route.path}`;
    if (machineKeys.has(key)) {
      throw new Error('Machine routes must be unique');
    }
    machineKeys.add(key);
  }

  const browserPrefixes = new Set();
  for (const route of accessManifest.browserRoutes) {
    exactKeys(route, ['pathPrefix', 'port'], 'browser route');
    if (!/^\/api\/[a-z0-9-]+$/u.test(route.pathPrefix)) {
      throw new Error('Browser route prefix is invalid');
    }
    assertPort(route.port, 'Browser route');
    if (browserPrefixes.has(route.pathPrefix)) {
      throw new Error('Browser route prefixes must be unique');
    }
    browserPrefixes.add(route.pathPrefix);
  }

  if (!Array.isArray(accessManifest.serviceRoutes) || accessManifest.serviceRoutes.length !== 1) {
    throw new Error('DEV service routes must contain only Matrix outbound');
  }
  const [matrixRoute] = accessManifest.serviceRoutes;
  exactKeys(matrixRoute, ['guard', 'pathPrefix', 'port'], 'service route');
  if (
    matrixRoute.guard !== 'cloudflare-service-auth-and-matrix-bearer' ||
    matrixRoute.pathPrefix !== MATRIX_PATH_PREFIX ||
    matrixRoute.port !== MATRIX_PORT
  ) {
    throw new Error('Service route must be the exact Matrix outbound contract');
  }
}

function validateProfileManifest() {
  exactKeys(
    profileManifest,
    ['draining', 'hibernated', 'matrix', 'postCutover', 'profiles', 'schemaVersion'],
    'DEV profile manifest'
  );
  exactKeys(profileManifest.draining, ['retainedMachinePaths', 'statusCode'], 'draining profile');
  exactKeys(profileManifest.hibernated, ['retryAfterSeconds', 'statusCode'], 'hibernated profile');
  exactKeys(profileManifest.matrix, ['accessLog', 'host'], 'Matrix profile');
  exactKeys(profileManifest.postCutover, ['matrixStatusCode'], 'post-cutover profile');
  if (profileManifest.schemaVersion !== 1) {
    throw new Error('DEV profile manifest schema version is invalid');
  }
  exactArray(profileManifest.profiles, EXPECTED_PROFILES, 'DEV profiles');
  if (
    profileManifest.postCutover.matrixStatusCode !== 410 ||
    profileManifest.draining.statusCode !== 503 ||
    profileManifest.hibernated.statusCode !== 503
  ) {
    throw new Error('DEV profile response status is invalid');
  }
  if (
    !Number.isInteger(profileManifest.hibernated.retryAfterSeconds) ||
    profileManifest.hibernated.retryAfterSeconds < 60 ||
    profileManifest.hibernated.retryAfterSeconds > 3600
  ) {
    throw new Error('Hibernated Retry-After must be between 60 and 3600 seconds');
  }
  if (
    profileManifest.matrix.host !== 'matrix-outbound.intexuraos.cloud' ||
    profileManifest.matrix.accessLog !== '/var/log/caddy/intexuraos-matrix-outbound-access.json'
  ) {
    throw new Error('Matrix production edge identity is invalid');
  }

  exactArray(
    profileManifest.draining.retainedMachinePaths,
    EXPECTED_DRAINING_CALLBACKS.map(({ path }) => path),
    'draining callback paths'
  );
  const actualDrainingCallbacks = profileManifest.draining.retainedMachinePaths.map((path) =>
    accessManifest.machineRoutes.find((route) => route.path === path)
  );
  if (JSON.stringify(actualDrainingCallbacks) !== JSON.stringify(EXPECTED_DRAINING_CALLBACKS)) {
    throw new Error('Draining callback method, guard, prefix, or port is invalid');
  }
}

function appendAccessLog(lines, accessLog) {
  lines.push(
    '  log {',
    `    output file ${accessLog} {`,
    '      roll_size 10MiB',
    '      roll_keep 90',
    '      roll_keep_for 2160h',
    '    }',
    '    format json',
    '  }'
  );
}

function appendStaticCacheHeaders(lines) {
  lines.push(
    '  @noCache {',
    '    path / /index.html /sw.js /manifest.webmanifest',
    '  }',
    '  header @noCache Cache-Control "no-cache, no-store, must-revalidate"',
    '  @immutableAssets {',
    '    path /assets/* /workbox-*.js',
    '  }',
    '  header @immutableAssets Cache-Control "public, max-age=31536000, immutable"'
  );
}

function appendMachineRoutes(lines, routes) {
  for (const [index, route] of routes.entries()) {
    lines.push(
      `  @machine${index} {`,
      `    method ${route.method}`,
      `    path ${route.path}`,
      '  }',
      `  handle @machine${index} {`,
      `    uri strip_prefix ${route.stripPrefix}`,
      `    reverse_proxy 127.0.0.1:${route.port}`,
      '  }',
      `  handle ${route.path} {`,
      '    respond "Method Not Allowed" 405',
      '  }'
    );
  }
}

function appendBrowserRoutes(lines) {
  for (const route of accessManifest.browserRoutes) {
    lines.push(
      `  handle_path ${route.pathPrefix}/* {`,
      `    reverse_proxy 127.0.0.1:${route.port}`,
      '  }'
    );
  }
}

function appendRetiredMatrixHandler(lines) {
  lines.push(
    '  @retiredMatrix {',
    `    path ${MATRIX_PATH_PREFIX} ${MATRIX_PATH_PREFIX}/*`,
    '  }',
    '  handle @retiredMatrix {',
    '    header Cache-Control "no-store"',
    '    header Content-Type "text/plain; charset=utf-8"',
    `    respond "Gone" ${profileManifest.postCutover.matrixStatusCode}`,
    '  }'
  );
}

function appendMatrixProxy(lines) {
  lines.push(
    `  handle_path ${MATRIX_PATH_PREFIX}/* {`,
    `    reverse_proxy 127.0.0.1:${MATRIX_PORT}`,
    '  }'
  );
}

function appendStaticFallback(lines) {
  lines.push(
    '  @forbidden {',
    '    path /src/* /@vite/* /@fs/* /.env* *.map /webhook',
    '  }',
    '  handle @forbidden {',
    '    respond "Not Found" 404',
    '  }',
    '  handle {',
    `    root * ${accessManifest.staticRoot}`,
    '    try_files {path} /index.html',
    '    file_server',
    '  }'
  );
}

function renderDevProfile(profile) {
  const lines = [
    `# Generated by scripts/generate-dev-caddy.mjs for ${profile}. Do not edit on the host.`,
    `${accessManifest.host}:80 {`,
  ];
  appendAccessLog(lines, DEV_ACCESS_LOG);

  if (profile === 'hibernated') {
    lines.push(
      '  header Cache-Control "no-store"',
      `  header Retry-After "${profileManifest.hibernated.retryAfterSeconds}"`,
      '  header Content-Type "text/plain; charset=utf-8"',
      `  respond "Service Unavailable" ${profileManifest.hibernated.statusCode}`
    );
  } else if (profile === 'draining') {
    const retainedPaths = new Set(profileManifest.draining.retainedMachinePaths);
    const retainedRoutes = accessManifest.machineRoutes.filter((route) =>
      retainedPaths.has(route.path)
    );
    appendMachineRoutes(lines, retainedRoutes);
    lines.push(
      '  handle {',
      '    header Cache-Control "no-store"',
      '    header Content-Type "text/plain; charset=utf-8"',
      `    respond "Service Unavailable" ${profileManifest.draining.statusCode}`,
      '  }'
    );
  } else {
    appendStaticCacheHeaders(lines);
    if (profile === 'active-post-cutover') {
      appendRetiredMatrixHandler(lines);
    }
    appendMachineRoutes(lines, accessManifest.machineRoutes);
    appendBrowserRoutes(lines);
    if (profile === 'active-pre-cutover') {
      appendMatrixProxy(lines);
    }
    appendStaticFallback(lines);
  }

  lines.push('}', '');
  return lines.join('\n');
}

function renderMatrixFragment() {
  const lines = [
    '# Generated by scripts/generate-dev-caddy.mjs for matrix-outbound. Do not edit on the host.',
    `${profileManifest.matrix.host}:80 {`,
  ];
  appendAccessLog(lines, profileManifest.matrix.accessLog);
  lines.push(
    '  @matrixOutbound {',
    `    path ${MATRIX_PATH_PREFIX} ${MATRIX_PATH_PREFIX}/*`,
    '  }',
    '  handle @matrixOutbound {',
    `    uri strip_prefix ${MATRIX_PATH_PREFIX}`,
    `    reverse_proxy 127.0.0.1:${MATRIX_PORT}`,
    '  }',
    '  handle {',
    '    header Cache-Control "no-store"',
    '    header Content-Type "text/plain; charset=utf-8"',
    '    respond "Not Found" 404',
    '  }',
    '}',
    ''
  );
  return lines.join('\n');
}

function parseSelection(args) {
  if (args.length === 1 && args[0] === '--matrix-fragment') {
    return { kind: 'matrix' };
  }
  if (args.length === 2 && args[0] === '--profile' && EXPECTED_PROFILES.includes(args[1])) {
    return { kind: 'profile', profile: args[1] };
  }
  throw new Error(
    `Usage: generate-dev-caddy.mjs --profile <${EXPECTED_PROFILES.join('|')}> | --matrix-fragment`
  );
}

validateAccessManifest();
validateProfileManifest();
const selection = parseSelection(process.argv.slice(2));
process.stdout.write(
  selection.kind === 'matrix' ? renderMatrixFragment() : renderDevProfile(selection.profile)
);
