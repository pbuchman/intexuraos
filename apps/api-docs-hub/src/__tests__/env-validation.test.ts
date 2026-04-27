import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { REQUIRED_ENV } from '../envValidation.js';
import { OPEN_API_SOURCE_CATALOG } from '../config.js';

describe('api-docs-hub REQUIRED_ENV', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('lists every OpenAPI source URL env var from the catalog', () => {
    expect([...REQUIRED_ENV].sort()).toEqual(
      OPEN_API_SOURCE_CATALOG.map((entry) => entry.openApiUrlEnvVar).sort()
    );
  });

  it('throws including the missing variable name when a required var is unset', () => {
    const sample = REQUIRED_ENV[0];
    if (sample === undefined) {
      throw new Error('REQUIRED_ENV must be non-empty');
    }
    process.env = Object.fromEntries(
      REQUIRED_ENV.filter((key) => key !== sample).map((key) => [
        key,
        'https://example.com/openapi.json',
      ])
    );

    expect(() => {
      validateRequiredEnv([...REQUIRED_ENV]);
    }).toThrow(sample);
  });

  it('passes silently when every required variable is set', () => {
    for (const key of REQUIRED_ENV) {
      process.env[key] = 'https://example.com/openapi.json';
    }

    expect(() => {
      validateRequiredEnv([...REQUIRED_ENV]);
    }).not.toThrow();
  });
});
