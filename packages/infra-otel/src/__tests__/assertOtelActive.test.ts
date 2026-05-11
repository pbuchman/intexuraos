import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertOtelActive, isNoopTracerProvider } from '../assertOtelActive.js';

function providerWithName(
  name: string,
  delegate?: unknown
): { constructor: { name: string }; getDelegate?: () => unknown } {
  return {
    constructor: { name },
    ...(delegate === undefined ? {} : { getDelegate: () => delegate }),
  };
}

describe('assertOtelActive', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('treats primitive providers as non-noop', () => {
    expect(isNoopTracerProvider(null)).toBe(false);
    expect(isNoopTracerProvider('provider')).toBe(false);
  });

  it('throws in prod when the active provider is the OpenTelemetry noop provider', () => {
    expect(() =>
      assertOtelActive({
        serviceName: 'code-agent',
        environment: 'prod',
        tracerProvider: providerWithName('NoopTracerProvider'),
      })
    ).toThrow('OpenTelemetry is not active for code-agent');
  });

  it('throws in prod when the proxy provider still delegates to the noop provider', () => {
    expect(() =>
      assertOtelActive({
        serviceName: 'code-agent',
        environment: 'prod',
        tracerProvider: providerWithName(
          'ProxyTracerProvider',
          providerWithName('NoopTracerProvider')
        ),
      })
    ).toThrow('OpenTelemetry is not active for code-agent');
  });

  it('accepts a proxy provider that delegates to a real provider in prod', () => {
    expect(() =>
      assertOtelActive({
        serviceName: 'code-agent',
        environment: 'prod',
        tracerProvider: providerWithName(
          'ProxyTracerProvider',
          providerWithName('NodeTracerProvider')
        ),
      })
    ).not.toThrow();
  });

  it('does not throw outside prod so dev/test can run without an OTLP collector', () => {
    expect(() =>
      assertOtelActive({
        serviceName: 'code-agent',
        environment: 'dev',
        tracerProvider: providerWithName('NoopTracerProvider'),
      })
    ).not.toThrow();
  });

  it('defaults missing environment to unknown', () => {
    vi.unstubAllEnvs();
    delete process.env['INTEXURAOS_ENVIRONMENT'];

    expect(() =>
      assertOtelActive({
        serviceName: 'code-agent',
        tracerProvider: providerWithName('NoopTracerProvider'),
      })
    ).not.toThrow();
  });

  it('uses the globally registered provider when no provider override is supplied', () => {
    vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'prod');

    expect(() => assertOtelActive({ serviceName: 'code-agent' })).toThrow(
      'OpenTelemetry is not active for code-agent'
    );
  });

  it('accepts a non-noop provider in prod', () => {
    const provider = providerWithName('NodeTracerProvider');
    expect(isNoopTracerProvider(provider)).toBe(false);
    expect(() =>
      assertOtelActive({
        serviceName: 'code-agent',
        environment: 'prod',
        tracerProvider: provider,
      })
    ).not.toThrow();
  });
});
