import { readFileSync } from 'node:fs';

function reject(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

function finalResponseHeaders(rawHeaders) {
  const blocks = rawHeaders
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter((block) => /^HTTP\/\S+\s+\d{3}(?:\s|$)/i.test(block));
  const finalBlock = blocks.at(-1);
  if (finalBlock === undefined) reject('HEALTH_HEADERS_INVALID');

  const headers = new Map();
  for (const line of finalBlock.split(/\r?\n/).slice(1)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

const [statusRaw, headersPath] = process.argv.slice(2);
if (statusRaw === undefined || !/^\d{3}$/.test(statusRaw) || headersPath === undefined) {
  reject('HEALTH_USAGE_INVALID');
}

const status = Number(statusRaw);
if (status < 200 || status >= 300) reject('HEALTH_HTTP_STATUS_INVALID');

let body;
let headers;
try {
  body = JSON.parse(readFileSync(0, 'utf8'));
  headers = finalResponseHeaders(readFileSync(headersPath, 'utf8'));
} catch {
  reject('HEALTH_JSON_INVALID');
}

const contentType = headers.get('content-type');
if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
  reject('HEALTH_CONTENT_TYPE_INVALID');
}
const cacheControl = headers.get('cache-control');
if (
  typeof cacheControl !== 'string' ||
  !cacheControl
    .split(',')
    .map((directive) => directive.trim().toLowerCase())
    .includes('no-store')
) {
  reject('HEALTH_CACHE_CONTROL_INVALID');
}

if (body === null || typeof body !== 'object' || Array.isArray(body)) {
  reject('HEALTH_JSON_INVALID');
}
if (body.status !== 'ok') reject('HEALTH_STATUS_INVALID');
if (body.serviceName !== 'code-agent') reject('HEALTH_SERVICE_NAME_INVALID');
if (typeof body.version !== 'string' || body.version.trim() === '') {
  reject('HEALTH_VERSION_INVALID');
}
if (!canonicalTimestamp(body.timestamp)) reject('HEALTH_TIMESTAMP_INVALID');
if (!Array.isArray(body.checks) || body.checks.length === 0) reject('HEALTH_CHECKS_EMPTY');

let firestoreHealthy = false;
for (const check of body.checks) {
  if (
    check === null ||
    typeof check !== 'object' ||
    Array.isArray(check) ||
    typeof check.name !== 'string' ||
    check.name.trim() === '' ||
    check.status !== 'ok' ||
    typeof check.latencyMs !== 'number' ||
    !Number.isFinite(check.latencyMs) ||
    check.latencyMs < 0
  ) {
    reject('HEALTH_CHECK_INVALID');
  }
  if (check.name === 'firestore') firestoreHealthy = true;
}

if (!firestoreHealthy) reject('HEALTH_FIRESTORE_REQUIRED');
