/**
 * Dual-token rotation tests for validateInternalAuth.
 *
 * Covers the rotation window where both INTEXURAOS_INTERNAL_AUTH_TOKEN
 * (current) and INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS (previous) are
 * configured and either is accepted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { validateInternalAuth } from '../auth/internalAuth.js';

interface FakeLogger {
  warn: ReturnType<typeof vi.fn>;
}

function makeRequest(headerValue: string | undefined): {
  request: FastifyRequest;
  logger: FakeLogger;
} {
  const logger: FakeLogger = { warn: vi.fn() };
  const headers: Record<string, string | string[] | undefined> = {};
  if (headerValue !== undefined) {
    headers['x-internal-auth'] = headerValue;
  }
  const request = {
    headers,
    log: logger,
  } as unknown as FastifyRequest;
  return { request, logger };
}

describe('validateInternalAuth — dual-token rotation', () => {
  let originalCurrent: string | undefined;
  let originalPrevious: string | undefined;

  beforeEach(() => {
    originalCurrent = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    originalPrevious = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'];
  });

  afterEach(() => {
    if (originalCurrent === undefined) {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    } else {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = originalCurrent;
    }
    if (originalPrevious === undefined) {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'];
    } else {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = originalPrevious;
    }
  });

  it('accepts CURRENT token and reports tokenUsed=current', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = 'previous-token';
    const { request, logger } = makeRequest('current-token');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: true, tokenUsed: 'current' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('accepts PREVIOUS token, reports tokenUsed=previous, and warns', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = 'previous-token';
    const { request, logger } = makeRequest('previous-token');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: true, tokenUsed: 'previous' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/PREVIOUS token accepted/);
  });

  it('rejects unknown token with token_mismatch when both are configured', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = 'previous-token';
    const { request, logger } = makeRequest('garbage');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'token_mismatch' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/token mismatch/);
  });

  it('rejects unknown token with token_mismatch when only CURRENT is configured', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    const { request, logger } = makeRequest('garbage');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'token_mismatch' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('returns not_configured when CURRENT is missing, even if PREVIOUS is set', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = 'previous-token';
    const { request, logger } = makeRequest('previous-token');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'not_configured' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/not configured/);
  });

  it('returns not_configured when CURRENT is missing and no header supplied', () => {
    const { request } = makeRequest(undefined);

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'not_configured' });
  });

  it('treats empty PREVIOUS as not configured (no fallback)', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = '';
    const { request, logger } = makeRequest('previous-token');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'token_mismatch' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/token mismatch/);
  });
});
