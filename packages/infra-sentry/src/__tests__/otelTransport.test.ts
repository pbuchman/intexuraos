/**
 * Tests for getOtelTransport - singleton OTel log transport factory.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const mockTransportStream = { write: vi.fn() };

vi.mock('pino', () => ({
  default: {
    transport: vi.fn(() => mockTransportStream),
  },
}));

import pino from 'pino';
import { getOtelTransport, _resetOtelTransport } from '../otelTransport.js';

const originalEnv = process.env;

describe('getOtelTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetOtelTransport();
    process.env = { ...originalEnv };
    delete process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'];
    delete process.env['OTEL_EXPORTER_OTLP_LOGS_HEADERS'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns undefined when INTEXURAOS_DASH0_OTLP_ENDPOINT is not set', () => {
    delete process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'];

    const result = getOtelTransport();

    expect(result).toBeUndefined();
    expect(pino.transport).not.toHaveBeenCalled();
  });

  it('returns undefined when INTEXURAOS_DASH0_OTLP_ENDPOINT is empty string', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = '';

    const result = getOtelTransport();

    expect(result).toBeUndefined();
    expect(pino.transport).not.toHaveBeenCalled();
  });

  it('creates transport when endpoint is set', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';
    process.env['INTEXURAOS_DASH0_AUTH_TOKEN'] = 'test-token';

    const result = getOtelTransport();

    expect(result).toBeDefined();
    expect(pino.transport).toHaveBeenCalledOnce();
    expect(pino.transport).toHaveBeenCalledWith({
      target: 'pino-opentelemetry-transport',
      options: {
        resourceAttributes: {
          'service.name': expect.any(String) as string,
          'deployment.environment.name': expect.any(String) as string,
        },
      },
    });
  });

  it('returns same instance on repeated calls (singleton)', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';

    const first = getOtelTransport();
    const second = getOtelTransport();

    expect(first).toBe(second);
    expect(pino.transport).toHaveBeenCalledOnce();
  });

  it('sets OTEL_EXPORTER_OTLP_LOGS_ENDPOINT env var', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';

    getOtelTransport();

    expect(process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']).toBe('https://otlp.dash0.com/v1/logs');
  });

  it('sets OTEL_EXPORTER_OTLP_LOGS_HEADERS when auth token is set', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';
    process.env['INTEXURAOS_DASH0_AUTH_TOKEN'] = 'my-token';

    getOtelTransport();

    expect(process.env['OTEL_EXPORTER_OTLP_LOGS_HEADERS']).toBe('Authorization=Bearer my-token');
  });

  it('does not set OTEL_EXPORTER_OTLP_LOGS_HEADERS when auth token is empty', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';
    process.env['INTEXURAOS_DASH0_AUTH_TOKEN'] = '';

    getOtelTransport();

    expect(process.env['OTEL_EXPORTER_OTLP_LOGS_HEADERS']).toBeUndefined();
  });

  it('uses OTEL_SERVICE_NAME when available', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';
    process.env['OTEL_SERVICE_NAME'] = 'my-custom-service';

    getOtelTransport();

    expect(pino.transport).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resourceAttributes: expect.objectContaining({
            'service.name': 'my-custom-service',
          }) as Record<string, string>,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>
    );
  });

  it('uses INTEXURAOS_ENVIRONMENT for deployment environment', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';
    process.env['INTEXURAOS_ENVIRONMENT'] = 'production';

    getOtelTransport();

    expect(pino.transport).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resourceAttributes: expect.objectContaining({
            'deployment.environment.name': 'production',
          }) as Record<string, string>,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>
    );
  });

  it('caches undefined result when endpoint is not set', () => {
    delete process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'];

    getOtelTransport();
    getOtelTransport();

    expect(pino.transport).not.toHaveBeenCalled();
  });

  it('falls back to npm_package_name when OTEL_SERVICE_NAME is not set', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';
    delete process.env['OTEL_SERVICE_NAME'];
    process.env['npm_package_name'] = '@intexuraos/test-svc';

    getOtelTransport();

    expect(pino.transport).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resourceAttributes: expect.objectContaining({
            'service.name': '@intexuraos/test-svc',
          }) as Record<string, string>,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>
    );
  });

  it('falls back to unknown-service when no service name env vars are set', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';
    delete process.env['OTEL_SERVICE_NAME'];
    delete process.env['npm_package_name'];

    getOtelTransport();

    expect(pino.transport).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resourceAttributes: expect.objectContaining({
            'service.name': 'unknown-service',
          }) as Record<string, string>,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>
    );
  });

  it('falls back to unknown when INTEXURAOS_ENVIRONMENT is not set', () => {
    process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'] = 'https://otlp.dash0.com';
    delete process.env['INTEXURAOS_ENVIRONMENT'];

    getOtelTransport();

    expect(pino.transport).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resourceAttributes: expect.objectContaining({
            'deployment.environment.name': 'unknown',
          }) as Record<string, string>,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>
    );
  });
});
