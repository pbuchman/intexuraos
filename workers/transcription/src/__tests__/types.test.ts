import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../types.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  const validEnv = {
    INTEXURAOS_SPEECHMATICS_APP_API_KEY: 'test-api-key',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'test-token',
    INTEXURAOS_USER_SERVICE_URL: 'http://user-service',
    INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC: 'transcription-completed-test',
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
    expect(config.gcpProjectId).toBe('test-project');
    expect(config.mediaBucket).toBe('test-bucket');
  });

  it('throws when INTEXURAOS_SPEECHMATICS_APP_API_KEY is missing', () => {
    delete process.env['INTEXURAOS_SPEECHMATICS_APP_API_KEY'];
    expect(() => loadConfig()).toThrow('INTEXURAOS_SPEECHMATICS_APP_API_KEY is required');
  });

  it('throws when INTEXURAOS_SPEECHMATICS_APP_API_KEY is empty', () => {
    process.env['INTEXURAOS_SPEECHMATICS_APP_API_KEY'] = '';
    expect(() => loadConfig()).toThrow('INTEXURAOS_SPEECHMATICS_APP_API_KEY is required');
  });

  it('throws when INTEXURAOS_INTERNAL_AUTH_TOKEN is missing', () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    expect(() => loadConfig()).toThrow('INTEXURAOS_INTERNAL_AUTH_TOKEN is required');
  });

  it('throws when INTEXURAOS_INTERNAL_AUTH_TOKEN is empty', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = '';
    expect(() => loadConfig()).toThrow('INTEXURAOS_INTERNAL_AUTH_TOKEN is required');
  });

  it('throws when INTEXURAOS_USER_SERVICE_URL is missing', () => {
    delete process.env['INTEXURAOS_USER_SERVICE_URL'];
    expect(() => loadConfig()).toThrow('INTEXURAOS_USER_SERVICE_URL is required');
  });

  it('throws when INTEXURAOS_USER_SERVICE_URL is empty', () => {
    process.env['INTEXURAOS_USER_SERVICE_URL'] = '';
    expect(() => loadConfig()).toThrow('INTEXURAOS_USER_SERVICE_URL is required');
  });

  it('throws when INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC is missing', () => {
    delete process.env['INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC'];
    expect(() => loadConfig()).toThrow(
      'INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC is required'
    );
  });

  it('throws when INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC is empty', () => {
    process.env['INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC'] = '';
    expect(() => loadConfig()).toThrow(
      'INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC is required'
    );
  });

  it('throws when INTEXURAOS_GCP_PROJECT_ID is missing', () => {
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    expect(() => loadConfig()).toThrow('INTEXURAOS_GCP_PROJECT_ID is required');
  });

  it('throws when INTEXURAOS_GCP_PROJECT_ID is empty', () => {
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = '';
    expect(() => loadConfig()).toThrow('INTEXURAOS_GCP_PROJECT_ID is required');
  });

  it('throws when INTEXURAOS_WHATSAPP_MEDIA_BUCKET is missing', () => {
    delete process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'];
    expect(() => loadConfig()).toThrow('INTEXURAOS_WHATSAPP_MEDIA_BUCKET is required');
  });

  it('throws when INTEXURAOS_WHATSAPP_MEDIA_BUCKET is empty', () => {
    process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'] = '';
    expect(() => loadConfig()).toThrow('INTEXURAOS_WHATSAPP_MEDIA_BUCKET is required');
  });
});
