import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

const publicKey = JSON.stringify({
  kty: 'OKP',
  crv: 'Ed25519',
  kid: 'matrix-test-v1',
  x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
});
const contextEncryptionKey = Buffer.alloc(32, 7).toString('base64url');

describe('loadConfig', () => {
  beforeEach(() => {
    clearConfigEnv();
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'false';
  });
  afterEach(clearConfigEnv);

  it('loads explicit environment values', () => {
    process.env['PORT'] = '8134';
    process.env['HOST'] = '127.0.0.1';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'project-1';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service.test';
    process.env['INTEXURAOS_NOTES_AGENT_URL'] = 'http://notes-agent.test';
    process.env['INTEXURAOS_CALENDAR_AGENT_URL'] = 'http://calendar-agent.test';
    process.env['INTEXURAOS_RESEARCH_AGENT_URL'] = 'http://research-agent.test';
    process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'] = 'http://bookmarks-agent.test';
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'http://code-agent.test';
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://dev.intexuraos.cloud';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://llm-usage.test';
    process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'openrouter-key';
    process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'] = 'whatsapp-send';
    process.env['INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS'] = '120000';

    expect(loadConfig()).toEqual({
      port: 8134,
      host: '127.0.0.1',
      gcpProjectId: 'project-1',
      internalAuthToken: 'secret',
      userServiceUrl: 'http://user-service.test',
      notesAgentUrl: 'http://notes-agent.test',
      calendarAgentUrl: 'http://calendar-agent.test',
      researchAgentUrl: 'http://research-agent.test',
      bookmarksAgentUrl: 'http://bookmarks-agent.test',
      codeAgentUrl: 'http://code-agent.test',
      webAppUrl: 'https://dev.intexuraos.cloud',
      llmUsageServiceUrl: 'http://llm-usage.test',
      openRouterAppApiKey: 'openrouter-key',
      whatsappSendTopic: 'whatsapp-send',
      sessionTimeoutMs: 120000,
      matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
      testRunsRead: { enabled: false },
    });
  });

  it('uses development defaults for optional process settings', () => {
    expect(loadConfig()).toEqual({
      port: 8080,
      host: '0.0.0.0',
      gcpProjectId: '',
      internalAuthToken: '',
      userServiceUrl: '',
      notesAgentUrl: '',
      calendarAgentUrl: '',
      researchAgentUrl: '',
      bookmarksAgentUrl: '',
      codeAgentUrl: '',
      webAppUrl: 'https://intexuraos.cloud',
      llmUsageServiceUrl: '',
      openRouterAppApiKey: '',
      whatsappSendTopic: '',
      sessionTimeoutMs: 30 * 60 * 1000,
      matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
      testRunsRead: { enabled: false },
    });
  });

  it.each([undefined, '', '   ', 'false'])(
    'keeps verification disabled for enable flag %s',
    (enabled) => {
      if (enabled === undefined) {
        delete process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED'];
      } else {
        process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED'] = enabled;
      }
      process.env['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY'] = publicKey;

      expect(loadConfig().matrixCorpus).toEqual({
        enabled: false,
        runtimeAudience: 'disabled',
      });
    }
  );

  it('parses the complete Home Dev verification configuration', () => {
    setEnabledMatrixCorpusEnv();

    expect(loadConfig().matrixCorpus).toEqual({
      enabled: true,
      runtimeAudience: 'home-dev',
      signingKeyVersion: 'matrix-test-v1',
      signingKeyMaterial: publicKey,
      evaluatorUserId: 'auth0:user_1',
      contextEncryptionKeyVersion: 'context-key-v1',
      contextEncryptionKeyMaterial: contextEncryptionKey,
    });
  });

  it('enables Test Runs reads only with the complete Home Dev Matrix corpus guard', () => {
    setEnabledMatrixCorpusEnv();
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'true';

    expect(loadConfig().testRunsRead).toEqual({
      enabled: true,
      runtimeAudience: 'home-dev',
      evaluatorUserId: 'auth0:user_1',
    });
  });

  it('accepts a canonical Auth0 Firebase subject for the Home Dev evaluator', () => {
    setEnabledMatrixCorpusEnv();
    process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'] = 'auth0|operator_1';

    expect(loadConfig().matrixCorpus).toMatchObject({
      enabled: true,
      evaluatorUserId: 'auth0|operator_1',
    });
  });

  it.each([undefined, '', 'TRUE', '1', 'yes'])('rejects a non-canonical Test Runs read flag: %s', (value) => {
    if (value === undefined) delete process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'];
    else process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = value;

    expect(() => loadConfig()).toThrow('INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED');
  });

  it('rejects Test Runs reads while the Matrix corpus runtime is disabled', () => {
    process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] = 'true';

    expect(() => loadConfig()).toThrow('INTEXURAOS_MATRIX_CORPUS_ENABLED');
  });

  it.each([
    'INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME',
    'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY',
  ] as const)('rejects enabled verification when %s is missing or blank', (name) => {
    setEnabledMatrixCorpusEnv();
    process.env[name] = '   ';

    expect(() => loadConfig()).toThrow(name);
  });

  it.each(['dev', 'prod', 'production', 'staging', 'unknown'])(
    'rejects verification audience %s',
    (runtimeAudience) => {
      setEnabledMatrixCorpusEnv();
      process.env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] = runtimeAudience;

      expect(() => loadConfig()).toThrow('INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE');
    }
  );

  it.each(['prod', 'production', 'staging', 'unknown'])(
    'rejects environment %s even with the Home Dev audience',
    (environment) => {
      setEnabledMatrixCorpusEnv();
      process.env['INTEXURAOS_ENVIRONMENT'] = environment;

      expect(() => loadConfig()).toThrow('INTEXURAOS_ENVIRONMENT');
    }
  );

  it.each([
    ['invalid JSON', 'not-json'],
    ['non-object JSON', 'null'],
    [
      'wrong key version',
      JSON.stringify({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'other-v1',
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ],
    [
      'private key instead of public key',
      JSON.stringify({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'matrix-test-v1',
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ],
    [
      'non-string public component',
      JSON.stringify({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'matrix-test-v1',
        x: 7,
      }),
    ],
    [
      'non-canonical public component',
      JSON.stringify({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'matrix-test-v1',
        x: 'short',
      }),
    ],
  ])('rejects %s without echoing key material', (_name, keyMaterial) => {
    setEnabledMatrixCorpusEnv();
    process.env['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY'] = keyMaterial;

    expect(() => loadConfig()).toThrow('INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY');
    try {
      loadConfig();
    } catch (error) {
      expect(String(error)).not.toContain(keyMaterial);
    }
  });

  it.each([
    ['wrong byte length', Buffer.alloc(31, 7).toString('base64url')],
    ['non-canonical encoding', `${contextEncryptionKey.slice(0, -1)}B`],
  ])('rejects %s for the context encryption key', (_name, keyMaterial) => {
    setEnabledMatrixCorpusEnv();
    process.env['INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY'] = keyMaterial;

    expect(() => loadConfig()).toThrow('INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY');
  });

  it('rejects an unknown enable value rather than silently disabling', () => {
    setEnabledMatrixCorpusEnv();
    process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED'] = 'yes';

    expect(() => loadConfig()).toThrow('INTEXURAOS_MATRIX_CORPUS_ENABLED');
  });
});

function setEnabledMatrixCorpusEnv(): void {
  process.env['INTEXURAOS_ENVIRONMENT'] = 'dev';
  process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED'] = 'true';
  process.env['INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME'] = 'home-dev';
  process.env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] = 'home-dev';
  process.env['INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION'] = 'matrix-test-v1';
  process.env['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY'] = publicKey;
  process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'] = 'auth0:user_1';
  process.env['INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION'] = 'context-key-v1';
  process.env['INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY'] = contextEncryptionKey;
}

function clearConfigEnv(): void {
  delete process.env['PORT'];
  delete process.env['HOST'];
  delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
  delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  delete process.env['INTEXURAOS_USER_SERVICE_URL'];
  delete process.env['INTEXURAOS_NOTES_AGENT_URL'];
  delete process.env['INTEXURAOS_CALENDAR_AGENT_URL'];
  delete process.env['INTEXURAOS_RESEARCH_AGENT_URL'];
  delete process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'];
  delete process.env['INTEXURAOS_CODE_AGENT_URL'];
  delete process.env['INTEXURAOS_WEB_APP_URL'];
  delete process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
  delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
  delete process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'];
  delete process.env['INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS'];
  delete process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'];
  delete process.env['INTEXURAOS_ENVIRONMENT'];
  delete process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED'];
  delete process.env['INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME'];
  delete process.env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'];
  delete process.env['INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION'];
  delete process.env['INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY'];
  delete process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'];
  delete process.env['INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION'];
  delete process.env['INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY'];
}
