/** Single-token hard-cutover tests for validateInternalAuth. */

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

describe('validateInternalAuth — single-token cutover', () => {
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

  it('rejects a stale token even when a legacy environment variable is present', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = 'previous-token';
    const { request, logger } = makeRequest('previous-token');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'token_mismatch' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ _skipSentry: true }),
      'Internal auth failed: token mismatch'
    );
  });

  it('rejects unknown token with token_mismatch when both are configured', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = 'previous-token';
    const { request, logger } = makeRequest('garbage');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'token_mismatch' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ _skipSentry: true }),
      'Internal auth failed: token mismatch'
    );
  });

  it('rejects unknown token with token_mismatch when only CURRENT is configured', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    const { request, logger } = makeRequest('garbage');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'token_mismatch' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ _skipSentry: true }),
      'Internal auth failed: token mismatch'
    );
  });

  it('returns not_configured when the supported token is missing', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = 'previous-token';
    const { request, logger } = makeRequest('previous-token');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'not_configured' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/not configured/);
    expect(logger.warn.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({ _skipSentry: true })
    );
  });

  it('returns not_configured when CURRENT is missing and no header supplied', () => {
    const { request } = makeRequest(undefined);

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'not_configured' });
  });

  it('does not change behavior when a stale legacy variable is empty', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-token';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = '';
    const { request, logger } = makeRequest('previous-token');

    const result = validateInternalAuth(request);

    expect(result).toEqual({ valid: false, reason: 'token_mismatch' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ _skipSentry: true }),
      'Internal auth failed: token mismatch'
    );
  });
});
