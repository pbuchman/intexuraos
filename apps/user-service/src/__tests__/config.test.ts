import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses the disabled sentinel without requiring a platform OpenRouter key', () => {
    process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'] = 'disabled';
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'false';
    delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];

    expect(loadConfig()).toMatchObject({
      intexAgentModelSelector: { status: 'disabled' },
      intexAgentTestRunsRead: { status: 'disabled' },
    });
  });

  it('uses every nonempty non-sentinel selector value as the exact eligible subject', () => {
    process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'] = 'test-selector-subject';
    process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'test-platform-key';
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'false';

    expect(loadConfig().intexAgentModelSelector).toEqual({
      status: 'enabled',
      userId: 'test-selector-subject',
      openRouterAppApiKey: 'test-platform-key',
    });
  });

  it('rejects enabled selector configuration without the platform OpenRouter key', () => {
    process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'] = 'test-selector-subject';
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'false';
    delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];

    expect(() => loadConfig()).toThrow('INTEXURAOS_OPENROUTER_APP_API_KEY is required');
  });

  it.each([undefined, ''])('rejects a missing selector subject: %s', (value) => {
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'false';
    if (value === undefined) delete process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'];
    else process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'] = value;

    expect(() => loadConfig()).toThrow('INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID is required');
  });

  it('enables Test Runs only for the exact Hetzner production evaluator subject', () => {
    process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'] = 'disabled';
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'true';
    process.env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] = 'hetzner-prod';
    process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'] = 'auth0|evaluator';

    expect(loadConfig().intexAgentTestRunsRead).toEqual({
      status: 'enabled',
      runtimeAudience: 'hetzner-prod',
      userId: 'auth0|evaluator',
    });
  });

  it('rejects enabled Test Runs outside Home Dev or without an evaluator subject', () => {
    process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'] = 'disabled';
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'true';
    process.env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] = 'production';
    process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'] = 'auth0|evaluator';
    expect(() => loadConfig()).toThrow(
      'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE must be hetzner-prod'
    );

    process.env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] = 'hetzner-prod';
    delete process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'];
    expect(() => loadConfig()).toThrow(
      'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID is required'
    );
  });

  it.each([undefined, '', 'TRUE', '1', 'yes'])('rejects a missing or non-canonical Test Runs flag: %s', (value) => {
    process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'] = 'disabled';
    if (value === undefined) delete process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'];
    else process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = value;

    expect(() => loadConfig()).toThrow('INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED');
  });
});
