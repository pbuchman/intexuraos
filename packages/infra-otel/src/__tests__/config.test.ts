import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildOtelConfig } from '../config.js';

describe('buildOtelConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns undefined when INTEXURAOS_DASH0_OTLP_ENDPOINT is not set', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', '');
    const config = buildOtelConfig();
    expect(config).toBeUndefined();
  });

  it('returns undefined when INTEXURAOS_DASH0_OTLP_ENDPOINT is empty string', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', '');
    const config = buildOtelConfig();
    expect(config).toBeUndefined();
  });

  it('returns config when endpoint is set', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', 'https://ingress.eu1.dash0.com');
    vi.stubEnv('INTEXURAOS_DASH0_AUTH_TOKEN', 'test-token');
    vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'dev');

    const config = buildOtelConfig();

    expect(config).toBeDefined();
    if (config === undefined) return;
    expect(config.endpoint).toBe('https://ingress.eu1.dash0.com');
    expect(config.authToken).toBe('test-token');
    expect(config.environment).toBe('dev');
  });

  it('defaults environment to "unknown" when not set', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', 'https://ingress.eu1.dash0.com');
    vi.stubEnv('INTEXURAOS_DASH0_AUTH_TOKEN', 'test-token');
    vi.stubEnv('INTEXURAOS_ENVIRONMENT', '');

    const config = buildOtelConfig();

    expect(config).toBeDefined();
    if (config === undefined) return;
    expect(config.environment).toBe('unknown');
  });

  it('defaults authToken to empty when env var is not set', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', 'http://localhost:4318');
    vi.stubEnv('INTEXURAOS_DASH0_AUTH_TOKEN', 'save-for-restore');
    delete process.env['INTEXURAOS_DASH0_AUTH_TOKEN'];

    const config = buildOtelConfig();

    expect(config).toBeDefined();
    if (config === undefined) return;
    expect(config.authToken).toBe('');
  });
});
