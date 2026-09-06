import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  ProductionHealthContractError,
  validateCodeAgentHealthResponse,
} from '../../scripts/lib/codeAgentProductionHealth.js';
import { runCodeAgentProductionHealthVerifier } from '../../scripts/verifyCodeAgentProductionHealth.js';

const validBody = (): Record<string, unknown> => ({
  status: 'ok',
  serviceName: 'code-agent',
  version: '3.8.0',
  timestamp: '2026-07-28T12:00:00.000Z',
  checks: [{ name: 'firestore', status: 'ok', latencyMs: 4, details: null }],
});

function response(overrides: {
  status?: number;
  contentType?: string;
  cacheControl?: string;
  body?: string;
} = {}): { status: number; headers: Record<string, string>; body: string } {
  return {
    status: overrides.status ?? 200,
    headers: {
      'content-type': overrides.contentType ?? 'application/json; charset=utf-8',
      'cache-control': overrides.cacheControl ?? 'no-cache, no-store, must-revalidate',
    },
    body: overrides.body ?? JSON.stringify(validBody()),
  };
}

describe('validateCodeAgentHealthResponse', () => {
  it('accepts only the canonical healthy code-agent Firestore contract', () => {
    expect(validateCodeAgentHealthResponse(response())).toEqual(validBody());
    expect(validateCodeAgentHealthResponse({
      ...response(),
      headers: new Headers(response().headers),
    })).toEqual(validBody());
  });

  it.each([
    ['HEALTH_HTTP_STATUS_INVALID', response({ status: 503 })],
    ['HEALTH_CONTENT_TYPE_INVALID', response({ contentType: 'text/plain' })],
    ['HEALTH_CACHE_CONTROL_INVALID', response({ cacheControl: 'public, max-age=60' })],
    ['HEALTH_JSON_INVALID', response({ body: '<html>ok</html>' })],
    ['HEALTH_JSON_INVALID', response({ body: 'null' })],
    ['HEALTH_JSON_INVALID', response({ body: '[]' })],
    ['HEALTH_STATUS_INVALID', response({ body: JSON.stringify({ ...validBody(), status: 'degraded' }) })],
    ['HEALTH_SERVICE_NAME_INVALID', response({ body: JSON.stringify({ ...validBody(), serviceName: 'other' }) })],
    ['HEALTH_VERSION_INVALID', response({ body: JSON.stringify({ ...validBody(), version: '' }) })],
    ['HEALTH_TIMESTAMP_INVALID', response({ body: JSON.stringify({ ...validBody(), timestamp: 'yesterday' }) })],
    ['HEALTH_TIMESTAMP_INVALID', response({ body: JSON.stringify({ ...validBody(), timestamp: null }) })],
    ['HEALTH_CHECKS_EMPTY', response({ body: JSON.stringify({ ...validBody(), checks: [] }) })],
    ['HEALTH_CHECK_INVALID', response({ body: JSON.stringify({ ...validBody(), checks: [
      { name: 'firestore', status: 'down', latencyMs: 1, details: null },
    ] }) })],
    ['HEALTH_CHECK_INVALID', response({ body: JSON.stringify({ ...validBody(), checks: [null] }) })],
    ['HEALTH_CHECK_INVALID', response({ body: JSON.stringify({ ...validBody(), checks: [[]] }) })],
    ['HEALTH_FIRESTORE_REQUIRED', response({ body: JSON.stringify({ ...validBody(), checks: [
      { name: 'secrets', status: 'ok', latencyMs: 1, details: null },
    ] }) })],
  ])('rejects %s', (code, input) => {
    expect(() => validateCodeAgentHealthResponse(input)).toThrowError(code);
    try {
      validateCodeAgentHealthResponse(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionHealthContractError);
      expect((error as ProductionHealthContractError).code).toBe(code);
    }
  });

  it('rejects missing headers and every malformed health-check field', () => {
    expect(() => validateCodeAgentHealthResponse({
      status: 200,
      headers: {},
      body: JSON.stringify(validBody()),
    })).toThrowError('HEALTH_CONTENT_TYPE_INVALID');
    expect(() => validateCodeAgentHealthResponse({
      ...response(),
      headers: new Headers(),
    })).toThrowError('HEALTH_CONTENT_TYPE_INVALID');
    expect(() => validateCodeAgentHealthResponse({
      ...response(),
      headers: new Headers({ 'content-type': 'application/json' }),
    })).toThrowError('HEALTH_CACHE_CONTROL_INVALID');
    expect(() => validateCodeAgentHealthResponse({
      ...response(),
      headers: { 'content-type': 'application/json' },
    })).toThrowError('HEALTH_CACHE_CONTROL_INVALID');

    const invalidChecks = [
      { name: 1, status: 'ok', latencyMs: 1 },
      { name: ' ', status: 'ok', latencyMs: 1 },
      { name: 'firestore', status: 'down', latencyMs: 1 },
      { name: 'firestore', status: 'ok', latencyMs: '1' },
      { name: 'firestore', status: 'ok', latencyMs: Number.POSITIVE_INFINITY },
      { name: 'firestore', status: 'ok', latencyMs: -1 },
    ];
    for (const check of invalidChecks) {
      expect(() => validateCodeAgentHealthResponse(response({
        body: JSON.stringify({ ...validBody(), checks: [check] }),
      }))).toThrowError('HEALTH_CHECK_INVALID');
    }
  });

  it('parses the final HTTP header block and validates a streamed response body', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'code-agent-health-'));
    const headersPath = join(directory, 'headers.txt');
    const originalStdin = process.stdin;
    await writeFile(headersPath, [
      'HTTP/1.1 301 Moved Permanently',
      'Location: https://example.invalid/health',
      '',
      'HTTP/2 200',
      'Malformed header',
      'Content-Type: application/json',
      'Cache-Control: no-store',
      '',
    ].join('\r\n'), 'utf8');
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: Readable.from([Buffer.from(JSON.stringify(validBody()))]),
    });
    try {
      await expect(runCodeAgentProductionHealthVerifier(['200', headersPath])).resolves.toBeUndefined();
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: Readable.from([JSON.stringify(validBody())]),
      });
      await expect(runCodeAgentProductionHealthVerifier(['200', headersPath])).resolves.toBeUndefined();
      await writeFile(headersPath, '', 'utf8');
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: Readable.from([JSON.stringify(validBody())]),
      });
      await expect(runCodeAgentProductionHealthVerifier(['200', headersPath]))
        .rejects.toThrowError('HEALTH_CONTENT_TYPE_INVALID');
      await expect(runCodeAgentProductionHealthVerifier([])).rejects.toThrowError('Usage:');
      await expect(runCodeAgentProductionHealthVerifier(['not-a-status', headersPath])).rejects.toThrowError('Usage:');
      await expect(runCodeAgentProductionHealthVerifier(['200'])).rejects.toThrowError('Usage:');
    } finally {
      Object.defineProperty(process, 'stdin', { configurable: true, value: originalStdin });
      await rm(directory, { recursive: true });
    }
  });

  it('reports a stable error code from the direct entry point', async () => {
    const originalArgv = process.argv;
    const previousExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
    const scriptPath = fileURLToPath(new URL('../../scripts/verifyCodeAgentProductionHealth.ts', import.meta.url));
    try {
      process.argv = [originalArgv[0] ?? 'node', scriptPath];
      vi.resetModules();
      await import('../../scripts/verifyCodeAgentProductionHealth.js');
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith('HEALTH_VERIFICATION_FAILED\n'));
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.exitCode = previousExitCode;
      stderr.mockRestore();
    }
  });

  it('reports a contract error code from the direct entry point', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'code-agent-health-direct-'));
    const headersPath = join(directory, 'headers.txt');
    await writeFile(headersPath, '', 'utf8');
    const originalArgv = process.argv;
    const originalStdin = process.stdin;
    const previousExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
    const scriptPath = fileURLToPath(new URL('../../scripts/verifyCodeAgentProductionHealth.ts', import.meta.url));
    try {
      process.argv = [originalArgv[0] ?? 'node', scriptPath, '200', headersPath];
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: Readable.from([JSON.stringify(validBody())]),
      });
      vi.resetModules();
      await import('../../scripts/verifyCodeAgentProductionHealth.js');
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith('HEALTH_CONTENT_TYPE_INVALID\n'));
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = originalArgv;
      Object.defineProperty(process, 'stdin', { configurable: true, value: originalStdin });
      process.exitCode = previousExitCode;
      stderr.mockRestore();
      await rm(directory, { recursive: true });
    }
  });
});
