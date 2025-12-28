/**
 * Tests for health check utilities.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock specific modules before importing health module
vi.mock('@intexuraos/common-core', () => ({
  getErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error'
  ),
}));

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import {
  checkSecrets,
  checkFirestore,
  checkNotionSdk,
  computeOverallStatus,
  buildHealthResponse,
  type HealthCheck,
} from '../health.js';

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

  describe('checkFirestore', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns ok with skip note in test environment (NODE_ENV=test)', async () => {
      process.env['NODE_ENV'] = 'test';

      const result = await checkFirestore();

      expect(result.name).toBe('firestore');
      expect(result.status).toBe('ok');
      expect(result.details).toEqual({ note: 'Skipped in test environment' });
    });

    it('returns ok with skip note when VITEST is set', async () => {
      process.env['VITEST'] = 'true';

      const result = await checkFirestore();

      expect(result.name).toBe('firestore');
      expect(result.status).toBe('ok');
      expect(result.details).toEqual({ note: 'Skipped in test environment' });
    });
  });

  describe('checkNotionSdk', () => {
    it('returns ok with passive mode details', () => {
      const result = checkNotionSdk();

      expect(result.name).toBe('notion-sdk');
      expect(result.status).toBe('ok');
      expect(result.details).toEqual({
        mode: 'passive',
        reason: 'Notion credentials are per-user; API validated per-request',
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('computeOverallStatus', () => {
    it('returns ok when all checks are ok', () => {
      const checks: HealthCheck[] = [
        { name: 'a', status: 'ok', latencyMs: 1, details: null },
        { name: 'b', status: 'ok', latencyMs: 2, details: null },
      ];

      expect(computeOverallStatus(checks)).toBe('ok');
    });

    it('returns down if any check is down', () => {
      const checks: HealthCheck[] = [
        { name: 'a', status: 'ok', latencyMs: 1, details: null },
        { name: 'b', status: 'down', latencyMs: 2, details: null },
        { name: 'c', status: 'degraded', latencyMs: 3, details: null },
      ];

      expect(computeOverallStatus(checks)).toBe('down');
    });

    it('returns degraded if any check is degraded and none are down', () => {
      const checks: HealthCheck[] = [
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
      const checks: HealthCheck[] = [
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
      const checks: HealthCheck[] = [
        { name: 'a', status: 'ok', latencyMs: 1, details: null },
        { name: 'b', status: 'down', latencyMs: 2, details: { error: 'Failed' } },
      ];

      const response = buildHealthResponse('svc', '0.0.1', checks);

      expect(response.status).toBe('down');
    });
  });
});
