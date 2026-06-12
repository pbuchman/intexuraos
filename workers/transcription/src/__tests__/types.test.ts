import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../types.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  const validEnv = {
    INTEXURAOS_SPEECHMATICS_APP_API_KEY: 'test-api-key',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'test-token',
    INTEXURAOS_USER_SERVICE_URL: 'http://user-service',
    INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC: 'transcription-completed-test',
    INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC: 'transcription-dlq-test',
    INTEXURAOS_GCP_PROJECT_ID: 'test-project',
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET: 'test-bucket',
  };

  beforeEach(() => {
    process.env = { ...originalEnv, ...validEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads all required config values', () => {
    const config = loadConfig();

    expect(config.speechmaticsApiKey).toBe('test-api-key');
    expect(config.internalAuthToken).toBe('test-token');
    expect(config.userServiceUrl).toBe('http://user-service');
    expect(config.transcriptionCompletedTopic).toBe('transcription-completed-test');
    expect(config.transcriptionDlqTopic).toBe('transcription-dlq-test');
    expect(config.gcpProjectId).toBe('test-project');
    expect(config.mediaBucket).toBe('test-bucket');
  });

  it.each([
    'INTEXURAOS_SPEECHMATICS_APP_API_KEY',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_USER_SERVICE_URL',
    'INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC',
    'INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC',
    'INTEXURAOS_GCP_PROJECT_ID',
    'INTEXURAOS_WHATSAPP_MEDIA_BUCKET',
  ])('throws when %s is missing', (key) => {
    // Static-string lookup keeps the lint rule happy while still running the
    // same `delete process.env[<KEY>]` semantics each iteration.
    Reflect.deleteProperty(process.env, key);
    expect(() => loadConfig()).toThrow(new RegExp(key));
  });

  it.each([
    'INTEXURAOS_SPEECHMATICS_APP_API_KEY',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_USER_SERVICE_URL',
    'INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC',
    'INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC',
    'INTEXURAOS_GCP_PROJECT_ID',
    'INTEXURAOS_WHATSAPP_MEDIA_BUCKET',
  ])('throws when %s is empty', (key) => {
    process.env[key] = '';
    expect(() => loadConfig()).toThrow(new RegExp(key));
  });

  it('aggregates multiple missing required vars in a single error', () => {
    delete process.env['INTEXURAOS_SPEECHMATICS_APP_API_KEY'];
    delete process.env['INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC'];

    expect(() => loadConfig()).toThrow(
      /INTEXURAOS_SPEECHMATICS_APP_API_KEY.*INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC/
    );
  });
});
