import { describe, it, expect } from 'vitest';
import { WORKER_TYPES } from '../types.js';

describe('WORKER_TYPES configuration', () => {
  it('uses generic opus alias so CLI resolves the latest model at runtime', () => {
    expect(WORKER_TYPES.opus.model).toBe('opus');
  });

  it('uses generic sonnet alias so CLI resolves the latest model at runtime', () => {
    expect(WORKER_TYPES.sonnet.model).toBe('sonnet');
  });

  it('does not set a model for auto worker type', () => {
    expect(WORKER_TYPES.auto.model).toBeUndefined();
  });

  it('routes opus workers to the Anthropic API', () => {
    expect(WORKER_TYPES.opus.apiBaseUrl).toBe('https://api.anthropic.com');
    expect(WORKER_TYPES.opus.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY');
  });
});
