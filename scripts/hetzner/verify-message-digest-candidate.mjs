#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, realpathSync, statSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deterministicDefinitionId } from '../message-digests/fishing-group-migration.mjs';

const CALLER_ROLE = 'message_digest_cutover_verifier';
const LEGACY_GROUP_KEY = 'grupa-wedkarska-skool';
const MAX_JSON_BYTES = 128 * 1024;
const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_LOCAL_ASSETS = 200;
const HTTP_TIMEOUT_MS = 10_000;
const MIGRATION_ID_PATTERN = /^mdm_[0-9a-f]{40}$/u;

export async function verifyMessageDigestCandidate(input, dependencies = {}) {
  try {
    const normalized = normalizeInput(input);
    const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
    if (typeof fetchImplementation !== 'function') throw safeError('INPUT_INVALID');
    const reports = verifyReports(normalized);
    await verifyHealth(normalized, fetchImplementation);
    const foreignUserId = deriveForeignUserId(normalized.migrationId);
    const definitionId = deterministicDefinitionId(normalized.migrationId);
    await verifyMessageDigestVisibility(
      normalized,
      foreignUserId,
      definitionId,
      fetchImplementation
    );
    await verifyPublicAuthenticationBoundary(normalized, definitionId, fetchImplementation);
    await verifyFishingVisibility(normalized, reports, fetchImplementation);
    await verifyOrdinaryMobileQuery(normalized, foreignUserId, fetchImplementation);
    await verifyZeroSchedulerTick(normalized, fetchImplementation);
    await verifyMalformedPubSubRejection(normalized, fetchImplementation);
    await verifyZeroSchedulerTick(normalized, fetchImplementation);
    const checkedAssets = await verifyIsolatedWeb(normalized.webRoot, fetchImplementation);
    return { ok: true, phase: normalized.phase, checkedServices: 4, checkedAssets };
  } catch (error) {
    if (isSafeCandidateError(error)) throw error;
    throw safeError('FAILED');
  }
}

function normalizeInput(input) {
  if (!isRecord(input) || !['staged', 'active'].includes(input.phase)) {
    throw safeError('INPUT_INVALID');
  }
  if (
    typeof input.internalAuthToken !== 'string' ||
    input.internalAuthToken.length < 16 ||
    input.internalAuthToken.length > 4096 ||
    typeof input.ownerUserId !== 'string' ||
    input.ownerUserId.trim() === '' ||
    input.ownerUserId.length > 256 ||
    typeof input.migrationId !== 'string' ||
    !MIGRATION_ID_PATTERN.test(input.migrationId) ||
    typeof input.webRoot !== 'string' ||
    !isAbsolute(input.webRoot) ||
    !isRecord(input.ports) ||
    !isRecord(input.reports)
  ) {
    throw safeError('INPUT_INVALID');
  }
  const ports = {
    whatsapp: normalizePort(input.ports.whatsapp),
    mobileNotifications: normalizePort(input.ports.mobileNotifications),
    fishingAssistant: normalizePort(input.ports.fishingAssistant),
    messageDigest: normalizePort(input.ports.messageDigest),
  };
  if (new Set(Object.values(ports)).size !== 4) throw safeError('INPUT_INVALID');
  const reports = {
    dryRun: normalizeAbsolutePath(input.reports.dryRun),
    apply: normalizeAbsolutePath(input.reports.apply),
    verify: normalizeAbsolutePath(input.reports.verify),
    ...(input.phase === 'active'
      ? { activation: normalizeAbsolutePath(input.reports.activation) }
      : {}),
  };
  if (input.phase === 'staged' && input.reports.activation !== undefined) {
    throw safeError('INPUT_INVALID');
  }
  return {
    phase: input.phase,
    ports,
    internalAuthToken: input.internalAuthToken,
    ownerUserId: input.ownerUserId,
    migrationId: input.migrationId,
    webRoot: input.webRoot,
    reports,
  };
}

function verifyReports(input) {
  const dryRun = readReport(input.reports.dryRun);
  const apply = readReport(input.reports.apply);
  const verify = readReport(input.reports.verify);
  assertReportHeader(dryRun, 'dry-run', 'ready', input.migrationId);
  assertReportHeader(apply, 'apply', 'staged', input.migrationId);
  assertReportHeader(
    verify,
    'verify',
    input.phase === 'staged' ? 'verified_staging' : 'verified_active',
    input.migrationId
  );
  const replayStartDate = reportDate(dryRun, 'replayStartDate');
  const replayEndDate = reportDate(dryRun, 'replayEndDate');
  if (replayStartDate > replayEndDate) throw safeError('REPORT_INVALID');
  for (const report of [apply, verify]) {
    if (
      reportDate(report, 'replayStartDate') !== replayStartDate ||
      reportDate(report, 'replayEndDate') !== replayEndDate
    ) {
      throw safeError('REPORT_INVALID');
    }
  }
  const replayDates = reportCount(dryRun, 'replayDates');
  const replayRuns = reportCount(verify, 'replayRuns');
  const visibleReplayRuns = reportCount(verify, 'visibleReplayRuns');
  const canonicalRuns = reportCount(verify, 'canonicalRuns');
  if (
    reportCount(dryRun, 'outboundEffects') !== 0 ||
    reportCount(apply, 'outboundEffects') !== 0 ||
    reportCount(verify, 'outboundEffects') !== 0 ||
    reportCount(apply, 'replayRuns') !== replayRuns ||
    reportCount(dryRun, 'visibleReplayRuns') !== visibleReplayRuns ||
    reportCount(apply, 'visibleReplayRuns') !== visibleReplayRuns ||
    reportCount(apply, 'canonicalRuns') !== canonicalRuns ||
    replayRuns !== replayDates ||
    visibleReplayRuns > replayRuns ||
    canonicalRuns < replayRuns
  ) {
    throw safeError('REPORT_INVALID');
  }
  const expectedDefinitions = input.phase === 'active' ? 1 : 0;
  const expectedCanonicalRuns = input.phase === 'active' ? canonicalRuns : 0;
  for (const field of ['publicDefinitions', 'fishingDefinitions']) {
    if (reportCount(verify, field) !== expectedDefinitions) throw safeError('REPORT_INVALID');
  }
  for (const field of ['publicRuns', 'fishingRuns']) {
    if (reportCount(verify, field) !== expectedCanonicalRuns) throw safeError('REPORT_INVALID');
  }
  if (input.phase === 'active') {
    const activation = readReport(input.reports.activation);
    assertReportHeader(activation, 'activate', 'active', input.migrationId);
    if (
      reportDate(activation, 'replayStartDate') !== replayStartDate ||
      reportDate(activation, 'replayEndDate') !== replayEndDate ||
      reportCount(activation, 'canonicalRuns') !== canonicalRuns ||
      reportCount(activation, 'outboundEffects') !== 0
    ) {
      throw safeError('REPORT_INVALID');
    }
  }
  return { replayStartDate, replayEndDate, visibleReplayRuns };
}

async function verifyHealth(input, fetchImplementation) {
  const services = [
    [input.ports.whatsapp, 'whatsapp-service'],
    [input.ports.mobileNotifications, 'mobile-notifications-service'],
    [input.ports.fishingAssistant, 'fishing-assistant-service'],
    [input.ports.messageDigest, 'message-digest-service'],
  ];
  for (const [port, serviceName] of services) {
    const response = await fetchJson(fetchImplementation, loopbackUrl(port, '/health'), {
      method: 'GET',
      expectedStatus: 200,
    });
    if (
      response.status !== 'ok' ||
      response.serviceName !== serviceName ||
      !Array.isArray(response.checks)
    ) {
      throw safeError('HEALTH_INVALID');
    }
  }
}

async function verifyMessageDigestVisibility(
  input,
  foreignUserId,
  definitionId,
  fetchImplementation
) {
  const response = await postProtectedJson(
    fetchImplementation,
    input,
    input.ports.messageDigest,
    '/internal/message-digests/cutover/check',
    { ownerUserId: input.ownerUserId, foreignUserId, definitionId }
  );
  const data = successData(response);
  if (
    !hasExactKeys(data, ['ownerDefinitionVisible', 'foreignDefinitionVisible']) ||
    data.ownerDefinitionVisible !== (input.phase === 'active') ||
    data.foreignDefinitionVisible !== false
  ) {
    throw safeError('VISIBILITY_INVALID');
  }
}

async function verifyPublicAuthenticationBoundary(input, definitionId, fetchImplementation) {
  const response = await fetchJson(
    fetchImplementation,
    loopbackUrl(input.ports.messageDigest, `/${encodeURIComponent(definitionId)}`),
    {
      method: 'GET',
      headers: { Authorization: 'Bearer message-digest-cutover-invalid' },
      expectedStatus: 401,
    }
  );
  if (
    response.success !== false ||
    !isRecord(response.error) ||
    response.error.code !== 'UNAUTHORIZED'
  ) {
    throw safeError('PUBLIC_AUTH_INVALID');
  }
}

async function verifyFishingVisibility(input, reports, fetchImplementation) {
  const response = await postProtectedJson(
    fetchImplementation,
    input,
    input.ports.fishingAssistant,
    '/internal/fishing-assistant/message-digests/cutover/check',
    {
      userId: input.ownerUserId,
      dateFrom: reports.replayStartDate,
      dateTo: reports.replayEndDate,
    }
  );
  const data = successData(response);
  if (
    !hasExactKeys(data, ['definitionCount', 'runCount']) ||
    data.definitionCount !== (input.phase === 'active' ? 1 : 0) ||
    data.runCount !== (input.phase === 'active' ? reports.visibleReplayRuns : 0)
  ) {
    throw safeError('FISHING_INVALID');
  }
}

async function verifyOrdinaryMobileQuery(input, foreignUserId, fetchImplementation) {
  const response = await postInternalJson(
    fetchImplementation,
    input,
    input.ports.mobileNotifications,
    '/internal/mobile-notifications/query',
    { userId: foreignUserId, limit: 1 }
  );
  const data = successData(response);
  if (!hasExactKeys(data, ['notifications']) || !Array.isArray(data.notifications)) {
    throw safeError('MOBILE_INVALID');
  }
}

async function verifyZeroSchedulerTick(input, fetchImplementation) {
  const response = await postInternalJson(
    fetchImplementation,
    input,
    input.ports.messageDigest,
    '/internal/message-digests/scheduler/tick',
    { limit: 1 }
  );
  const data = successData(response);
  if (
    !hasExactKeys(data, [
      'ok',
      'recoveredDispatches',
      'reconciledDeliveries',
      'reservedRuns',
      'deferredDefinitions',
      'nextCursor',
    ]) ||
    data.ok !== true ||
    data.recoveredDispatches !== 0 ||
    data.reconciledDeliveries !== 0 ||
    data.reservedRuns !== 0 ||
    data.deferredDefinitions !== 0 ||
    data.nextCursor !== null
  ) {
    throw safeError('SCHEDULER_NOT_QUIET');
  }
}

async function verifyMalformedPubSubRejection(input, fetchImplementation) {
  const response = await fetchJson(
    fetchImplementation,
    loopbackUrl(input.ports.messageDigest, '/internal/message-digests/pubsub/run'),
    {
      method: 'POST',
      headers: internalHeaders(input),
      body: JSON.stringify({
        message: {
          data: Buffer.from('{}', 'utf8').toString('base64'),
          messageId: 'candidate-malformed-proof',
          publishTime: '2026-01-01T00:00:00.000Z',
        },
        subscription: 'candidate-malformed-proof',
      }),
      expectedStatus: 400,
    }
  );
  if (
    response.success !== false ||
    !isRecord(response.error) ||
    response.error.code !== 'INVALID_REQUEST'
  ) {
    throw safeError('PUBSUB_REJECTION_INVALID');
  }
}

async function postProtectedJson(fetchImplementation, input, port, path, body) {
  return await fetchJson(fetchImplementation, loopbackUrl(port, path), {
    method: 'POST',
    headers: { ...internalHeaders(input), 'X-Internal-Caller-Role': CALLER_ROLE },
    body: JSON.stringify(body),
    expectedStatus: 200,
  });
}

async function postInternalJson(fetchImplementation, input, port, path, body) {
  return await fetchJson(fetchImplementation, loopbackUrl(port, path), {
    method: 'POST',
    headers: internalHeaders(input),
    body: JSON.stringify(body),
    expectedStatus: 200,
  });
}

function internalHeaders(input) {
  return {
    'Content-Type': 'application/json',
    'X-Internal-Auth': input.internalAuthToken,
  };
}

async function verifyIsolatedWeb(webRoot, fetchImplementation) {
  return await withStaticWebServer(webRoot, async (baseUrl) => {
    const indexBytes = await fetchBytes(fetchImplementation, `${baseUrl}/`, {
      expectedStatus: 200,
      maxBytes: MAX_INDEX_BYTES,
    });
    const index = indexBytes.toString('utf8');
    const assets = localAssetPaths(index);
    if (assets.length === 0 || assets.length > MAX_LOCAL_ASSETS) throw safeError('WEB_INVALID');
    for (const asset of assets) {
      const bytes = await fetchBytes(fetchImplementation, `${baseUrl}${asset}`, {
        expectedStatus: 200,
        maxBytes: MAX_ASSET_BYTES,
      });
      if (bytes.length === 0) throw safeError('WEB_INVALID');
    }
    return assets.length;
  });
}

function localAssetPaths(index) {
  const assets = new Set();
  const pattern = /(?:src|href)\s*=\s*["']([^"']+)["']/giu;
  for (const match of index.matchAll(pattern)) {
    const reference = match[1];
    if (
      typeof reference !== 'string' ||
      reference === '' ||
      reference.startsWith('#') ||
      reference.startsWith('//') ||
      /^[a-z][a-z0-9+.-]*:/iu.test(reference)
    ) {
      continue;
    }
    const pathname = reference.split(/[?#]/u, 1)[0];
    if (pathname === undefined || pathname === '' || pathname === '/') continue;
    assets.add(pathname.startsWith('/') ? pathname : `/${pathname.replace(/^\.\//u, '')}`);
  }
  return [...assets].sort();
}

async function withStaticWebServer(webRoot, operation) {
  let root;
  try {
    root = realpathSync(webRoot);
    if (!statSync(root).isDirectory()) throw new Error('not a directory');
  } catch {
    throw safeError('WEB_INVALID');
  }
  const server = createServer((request, response) => {
    try {
      if (request.method !== 'GET') {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const candidate = realpathSync(resolve(root, requested));
      const escaped = relative(root, candidate);
      const stat = statSync(candidate);
      if (escaped.startsWith('..') || isAbsolute(escaped) || !stat.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      const stream = createReadStream(candidate);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  try {
    await new Promise((resolveListening, rejectListening) => {
      server.once('error', rejectListening);
      server.listen(0, '127.0.0.1', resolveListening);
    });
    const address = server.address();
    if (!isRecord(address) || typeof address.port !== 'number') throw safeError('WEB_INVALID');
    return await operation(`http://127.0.0.1:${String(address.port)}`);
  } catch (error) {
    if (isSafeCandidateError(error)) throw error;
    throw safeError('WEB_INVALID');
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  }
}

async function fetchJson(fetchImplementation, url, options) {
  const bytes = await fetchBytes(fetchImplementation, url, {
    ...options,
    maxBytes: MAX_JSON_BYTES,
    expectedContentType: 'application/json',
  });
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value)) throw new Error('not an object');
    return value;
  } catch {
    throw safeError('HTTP_RESPONSE_INVALID');
  }
}

async function fetchBytes(fetchImplementation, url, options) {
  let response;
  try {
    response = await fetchImplementation(url, {
      method: options.method ?? 'GET',
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.body === undefined ? {} : { body: options.body }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    throw safeError('HTTP_REQUEST_FAILED');
  }
  if (!isRecord(response) || response.status !== options.expectedStatus) {
    throw safeError('HTTP_STATUS_INVALID');
  }
  if (
    options.expectedContentType === 'application/json' &&
    !/^application\/json(?:\s*;|$)/iu.test(response.headers?.get?.('content-type') ?? '')
  ) {
    throw safeError('HTTP_RESPONSE_INVALID');
  }
  return await readBoundedBody(response, options.maxBytes);
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && (declared < 0 || declared > maxBytes)) {
    throw safeError('HTTP_RESPONSE_TOO_LARGE');
  }
  if (response.body === null || response.body === undefined) {
    throw safeError('HTTP_RESPONSE_INVALID');
  }
  const chunks = [];
  let size = 0;
  if (typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        appendBoundedChunk(
          chunks,
          value,
          maxBytes,
          (nextSize) => {
            size = nextSize;
          },
          size
        );
      }
    } catch (error) {
      if (isSafeCandidateError(error)) throw error;
      throw safeError('HTTP_RESPONSE_INVALID');
    } finally {
      reader.releaseLock();
    }
  } else if (typeof response.body[Symbol.asyncIterator] === 'function') {
    try {
      for await (const value of response.body) {
        appendBoundedChunk(
          chunks,
          value,
          maxBytes,
          (nextSize) => {
            size = nextSize;
          },
          size
        );
      }
    } catch (error) {
      if (isSafeCandidateError(error)) throw error;
      throw safeError('HTTP_RESPONSE_INVALID');
    }
  } else {
    throw safeError('HTTP_RESPONSE_INVALID');
  }
  return Buffer.concat(chunks, size);
}

function appendBoundedChunk(chunks, value, maxBytes, setSize, currentSize) {
  if (!(value instanceof Uint8Array) && !Buffer.isBuffer(value)) {
    throw safeError('HTTP_RESPONSE_INVALID');
  }
  const chunk = Buffer.from(value);
  const nextSize = currentSize + chunk.byteLength;
  if (nextSize > maxBytes) throw safeError('HTTP_RESPONSE_TOO_LARGE');
  chunks.push(chunk);
  setSize(nextSize);
}

function successData(response) {
  if (response.success !== true || !isRecord(response.data)) {
    throw safeError('HTTP_RESPONSE_INVALID');
  }
  return response.data;
}

function readReport(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_REPORT_BYTES) {
      throw new Error('invalid report file');
    }
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(value)) throw new Error('invalid report');
    return value;
  } catch {
    throw safeError('REPORT_INVALID');
  }
}

function assertReportHeader(report, mode, status, migrationId) {
  if (report.mode !== mode || report.status !== status || report.migrationId !== migrationId) {
    throw safeError('REPORT_INVALID');
  }
}

function reportCount(report, field) {
  const value = isRecord(report.counts) ? report.counts[field] : undefined;
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw safeError('REPORT_INVALID');
  }
  return value;
}

function reportDate(report, field) {
  const value = report[field];
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw safeError('REPORT_INVALID');
  }
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString().slice(0, 10) !== value) {
    throw safeError('REPORT_INVALID');
  }
  return value;
}

function deriveForeignUserId(migrationId) {
  const digest = createHash('sha256').update(migrationId, 'utf8').digest('hex').slice(0, 32);
  return `message-digest-cutover-foreign-${digest}`;
}

function loopbackUrl(port, path) {
  return `http://127.0.0.1:${String(port)}${path}`;
}

function normalizePort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw safeError('INPUT_INVALID');
  }
  return value;
}

function normalizeAbsolutePath(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw safeError('INPUT_INVALID');
  return value;
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const observed = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    observed.length === expected.length && observed.every((key, index) => key === expected[index])
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeError(code) {
  return new Error(`MESSAGE_DIGEST_CANDIDATE_${code}`);
}

function isSafeCandidateError(error) {
  return error instanceof Error && /^MESSAGE_DIGEST_CANDIDATE_[A-Z_]+$/u.test(error.message);
}

function parseCli(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      typeof name !== 'string' ||
      !name.startsWith('--') ||
      typeof value !== 'string' ||
      value.startsWith('--') ||
      values.has(name)
    ) {
      throw safeError('INPUT_INVALID');
    }
    values.set(name, value);
    index += 1;
  }
  const phase = requiredCli(values, '--phase');
  return {
    phase,
    ports: {
      whatsapp: Number(requiredCli(values, '--whatsapp-port')),
      mobileNotifications: Number(requiredCli(values, '--mobile-port')),
      fishingAssistant: Number(requiredCli(values, '--fishing-port')),
      messageDigest: Number(requiredCli(values, '--message-digest-port')),
    },
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
    ownerUserId: process.env['INTEXURAOS_MESSAGE_DIGEST_MIGRATION_USER_ID'],
    migrationId: requiredCli(values, '--migration-id'),
    webRoot: requiredCli(values, '--web-root'),
    reports: {
      dryRun: requiredCli(values, '--dry-run-report'),
      apply: requiredCli(values, '--apply-report'),
      verify: requiredCli(values, '--verify-report'),
      ...(phase === 'active' ? { activation: requiredCli(values, '--activation-report') } : {}),
    },
  };
}

function requiredCli(values, name) {
  const value = values.get(name);
  if (typeof value !== 'string' || value === '') throw safeError('INPUT_INVALID');
  return value;
}

async function main() {
  const input = parseCli(process.argv.slice(2));
  const result = await verifyMessageDigestCandidate(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safe = isSafeCandidateError(error) ? error.message : 'MESSAGE_DIGEST_CANDIDATE_FAILED';
    process.stderr.write(`ERROR: ${safe}\n`);
    process.exitCode = 1;
  });
}
