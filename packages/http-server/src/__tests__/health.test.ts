/**
 * Tests for health check utilities.
 *
 * Note: Firestore- and Notion-specific probes were removed from this
 * package. Their replacements live in `@intexuraos/infra-firestore` and
 * `apps/notion-service` respectively, and are tested there. This file
 * covers the package-local utilities (data-shape helpers, the new
 * functional `HealthCheck`, and the `registerHealthCheck` plugin).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import {
  buildHealthResponse,
  checkSecrets,
  computeOverallStatus,
  registerHealthCheck,
  secretsHealthCheck,
  validateRequiredEnv,
  type HealthCheck,
  type HealthCheckResult,
  type HealthResponse,
} from '../health.js';

vi.mock('@intexuraos/common-core', () => ({
  getErrorMessage: vi.fn((error: unknown) =>
    // eslint-disable-next-line no-restricted-syntax -- Mocking getErrorMessage itself
    error instanceof Error ? error.message : 'Unknown error'
  ),
}));

describe('Health Utilities', () => {
  describe('checkSecrets', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns ok when all secrets are present', () => {
      process.env['SECRET_A'] = 'value-a';
      process.env['SECRET_B'] = 'value-b';

      const result = checkSecrets(['SECRET_A', 'SECRET_B']);

      expect(result.name).toBe('secrets');
      expect(result.status).toBe('ok');
      expect(result.details).toBeNull();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns down with missing secrets list', () => {
      process.env['SECRET_A'] = 'value-a';
      // SECRET_B not set

      const result = checkSecrets(['SECRET_A', 'SECRET_B']);

      expect(result.name).toBe('secrets');
      expect(result.status).toBe('down');
      expect(result.details).toEqual({ missing: ['SECRET_B'] });
    });

    it('treats empty string as missing', () => {
      process.env['SECRET_A'] = '';

      const result = checkSecrets(['SECRET_A']);

      expect(result.status).toBe('down');
      expect(result.details).toEqual({ missing: ['SECRET_A'] });
    });

    it('handles empty required list', () => {
      const result = checkSecrets([]);

      expect(result.status).toBe('ok');
      expect(result.details).toBeNull();
    });
  });

  describe('secretsHealthCheck', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns a probe named "secrets"', () => {
      expect(secretsHealthCheck([]).name).toBe('secrets');
    });

    it('reports ok when every required variable is set', async () => {
      process.env['SECRET_A'] = 'value';
      const outcome = await secretsHealthCheck(['SECRET_A']).check();
      expect(outcome).toEqual({ ok: true });
    });

    it('reports ok=false with missing names in detail when any variable is absent', async () => {
      delete process.env['SECRET_A'];
      delete process.env['SECRET_B'];
      const outcome = await secretsHealthCheck(['SECRET_A', 'SECRET_B']).check();
      expect(outcome).toEqual({ ok: false, detail: 'missing: SECRET_A, SECRET_B' });
    });
  });

  describe('validateRequiredEnv', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('does not throw when all required vars are present', () => {
      process.env['VAR_A'] = 'value-a';
      process.env['VAR_B'] = 'value-b';

      expect(() => validateRequiredEnv(['VAR_A', 'VAR_B'])).not.toThrow();
    });

    it('throws when a required var is missing', () => {
      process.env['VAR_A'] = 'value-a';

      expect(() => validateRequiredEnv(['VAR_A', 'VAR_B'])).toThrow(
        'Missing required environment variables: VAR_B'
      );
    });

    it('throws when a required var is empty string', () => {
      process.env['VAR_A'] = 'value-a';
      process.env['VAR_B'] = '';

      expect(() => validateRequiredEnv(['VAR_A', 'VAR_B'])).toThrow(
        'Missing required environment variables: VAR_B'
      );
    });

    it('throws listing all missing vars', () => {
      expect(() => validateRequiredEnv(['VAR_A', 'VAR_B', 'VAR_C'])).toThrow(
        'Missing required environment variables: VAR_A, VAR_B, VAR_C'
      );
    });

    it('includes help message in error', () => {
      expect(() => validateRequiredEnv(['MISSING_VAR'])).toThrow(
        'Ensure these are set in Terraform env_vars or .envrc.local for local development.'
      );
    });

    it('does not throw for empty required array', () => {
      expect(() => validateRequiredEnv([])).not.toThrow();
    });
  });

  describe('computeOverallStatus', () => {
    it('returns ok when all checks are ok', () => {
      const checks: HealthCheckResult[] = [
        { name: 'a', status: 'ok', latencyMs: 1, details: null },
        { name: 'b', status: 'ok', latencyMs: 2, details: null },
      ];

      expect(computeOverallStatus(checks)).toBe('ok');
    });

    it('returns down if any check is down', () => {
      const checks: HealthCheckResult[] = [
        { name: 'a', status: 'ok', latencyMs: 1, details: null },
        { name: 'b', status: 'down', latencyMs: 2, details: null },
        { name: 'c', status: 'degraded', latencyMs: 3, details: null },
      ];

      expect(computeOverallStatus(checks)).toBe('down');
    });

    it('returns degraded if any check is degraded and none are down', () => {
      const checks: HealthCheckResult[] = [
        { name: 'a', status: 'ok', latencyMs: 1, details: null },
        { name: 'b', status: 'degraded', latencyMs: 2, details: null },
      ];

      expect(computeOverallStatus(checks)).toBe('degraded');
    });

    it('returns ok for empty checks array', () => {
      expect(computeOverallStatus([])).toBe('ok');
    });
  });

  describe('buildHealthResponse', () => {
    it('builds a complete health response', () => {
      const checks: HealthCheckResult[] = [
        { name: 'secrets', status: 'ok', latencyMs: 1, details: null },
        { name: 'firestore', status: 'ok', latencyMs: 50, details: null },
      ];

      const response = buildHealthResponse('test-service', '1.0.0', checks);

      expect(response.serviceName).toBe('test-service');
      expect(response.version).toBe('1.0.0');
      expect(response.status).toBe('ok');
      expect(response.checks).toBe(checks);
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('computes status from checks', () => {
      const checks: HealthCheckResult[] = [
        { name: 'a', status: 'ok', latencyMs: 1, details: null },
        { name: 'b', status: 'down', latencyMs: 2, details: { error: 'Failed' } },
      ];

      const response = buildHealthResponse('svc', '0.0.1', checks);

      expect(response.status).toBe('down');
    });
  });

  describe('registerHealthCheck', () => {
    it('registers GET /health and reports overall ok when every probe is ok', async () => {
      const app = Fastify({ logger: false });
      const okCheck: HealthCheck = {
        name: 'noop',
        check: () => Promise.resolve({ ok: true }),
      };

      await registerHealthCheck(app, {
        serviceName: 'svc',
        version: '1.2.3',
        checks: [okCheck],
      });

      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as HealthResponse;
      expect(body.serviceName).toBe('svc');
      expect(body.version).toBe('1.2.3');
      expect(body.status).toBe('ok');
      expect(body.checks).toHaveLength(1);
      expect(body.checks[0]?.name).toBe('noop');
      expect(body.checks[0]?.status).toBe('ok');
      expect(body.checks[0]?.details).toBeNull();
      expect(body.checks[0]?.latencyMs).toBeGreaterThanOrEqual(0);
      expect(res.headers['x-health-duration-ms']).toBeDefined();

      await app.close();
    });

    it('marks the response down when a probe returns ok=false with detail', async () => {
      const app = Fastify({ logger: false });
      const failing: HealthCheck = {
        name: 'failing',
        check: () => Promise.resolve({ ok: false, detail: 'unreachable' }),
      };

      await registerHealthCheck(app, {
        serviceName: 'svc',
        version: '1.0.0',
        checks: [failing],
      });

      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as HealthResponse;
      expect(body.status).toBe('down');
      expect(body.checks[0]?.status).toBe('down');
      expect(body.checks[0]?.details).toEqual({ detail: 'unreachable' });

      await app.close();
    });

    it('marks the response down with thrown error in details when a probe throws', async () => {
      const app = Fastify({ logger: false });
      const throwing: HealthCheck = {
        name: 'throws',
        check: () => Promise.reject(new Error('boom')),
      };

      await registerHealthCheck(app, {
        serviceName: 'svc',
        version: '1.0.0',
        checks: [throwing],
      });

      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = JSON.parse(res.body) as HealthResponse;

      expect(body.status).toBe('down');
      expect(body.checks[0]?.details).toEqual({ error: 'boom' });

      await app.close();
    });

    it('runs every probe and aggregates the worst status (down dominates degraded)', async () => {
      const app = Fastify({ logger: false });
      const ok: HealthCheck = { name: 'ok', check: () => Promise.resolve({ ok: true }) };
      const down: HealthCheck = {
        name: 'down',
        check: () => Promise.resolve({ ok: false }),
      };

      await registerHealthCheck(app, {
        serviceName: 'svc',
        version: '1.0.0',
        checks: [ok, down],
      });

      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = JSON.parse(res.body) as HealthResponse;

      expect(body.status).toBe('down');
      expect(body.checks).toHaveLength(2);

      await app.close();
    });

    it('returns ok with no checks when callers pass an empty array', async () => {
      const app = Fastify({ logger: false });

      await registerHealthCheck(app, {
        serviceName: 'svc',
        version: '0.0.1',
        checks: [],
      });

      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = JSON.parse(res.body) as HealthResponse;

      expect(body.status).toBe('ok');
      expect(body.checks).toEqual([]);

      await app.close();
    });

    it('emits ok with null details for a probe that returns ok=false without detail', async () => {
      const app = Fastify({ logger: false });
      const downNoDetail: HealthCheck = {
        name: 'silent-down',
        check: () => Promise.resolve({ ok: false }),
      };

      await registerHealthCheck(app, {
        serviceName: 'svc',
        version: '1.0.0',
        checks: [downNoDetail],
      });

      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = JSON.parse(res.body) as HealthResponse;

      expect(body.checks[0]?.status).toBe('down');
      expect(body.checks[0]?.details).toBeNull();

      await app.close();
    });

    it('uses Unknown error message for non-Error rejections', async () => {
      const app = Fastify({ logger: false });
      // Construct a probe that rejects with a non-Error value at runtime.
      // Tested via a wrapper so the linter (no-floating-promises /
      // prefer-promise-reject-errors) sees an Error in source while the
      // rejected value at runtime is a plain string.
      const throwingString: HealthCheck = {
        name: 'string-throw',
        check: () => {
          const p = new Promise((_resolve, reject) => {
            reject('plain string');
          });
          return p as Promise<{ ok: true } | { ok: false; detail?: string }>;
        },
      };

      await registerHealthCheck(app, {
        serviceName: 'svc',
        version: '1.0.0',
        checks: [throwingString],
      });

      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = JSON.parse(res.body) as HealthResponse;

      expect(body.checks[0]?.status).toBe('down');
      expect(body.checks[0]?.details).toEqual({ error: 'Unknown error' });

      await app.close();
    });
  });
});
