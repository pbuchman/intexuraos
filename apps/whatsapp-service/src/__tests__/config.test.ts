/**
 * Tests for config validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config validation', () => {
  let savedVerify: string | undefined;
  let savedSecret: string | undefined;
  let savedAccess: string | undefined;
  let savedWaba: string | undefined;
  let savedPhone: string | undefined;

  beforeEach(() => {
    savedVerify = process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    savedSecret = process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    savedAccess = process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    savedWaba = process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    savedPhone = process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
  });

  afterEach(() => {
    // Restore
    if (savedVerify !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = savedVerify;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    }
    if (savedSecret !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = savedSecret;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    }
    if (savedAccess !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = savedAccess;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    }
    if (savedWaba !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = savedWaba;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    }
    if (savedPhone !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = savedPhone;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
    }
  });

  it('validates required env vars', async () => {
    const { validateConfigEnv } = await import('../config.js');

    delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];

    const missing = validateConfigEnv();
    expect(missing).toContain('INTEXURAOS_WHATSAPP_VERIFY_TOKEN');
    expect(missing).toContain('INTEXURAOS_WHATSAPP_APP_SECRET');
    expect(missing).toContain('INTEXURAOS_WHATSAPP_WABA_ID');
  });

  it('returns empty array when all required vars present', async () => {
    const { validateConfigEnv } = await import('../config.js');

    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = 'test';

    const missing = validateConfigEnv();
    expect(missing).toHaveLength(0);
  });

  it('treats empty string as missing', async () => {
    const { validateConfigEnv } = await import('../config.js');

    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = '';
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = 'test';

    const missing = validateConfigEnv();
    expect(missing).toContain('INTEXURAOS_WHATSAPP_VERIFY_TOKEN');
  });

  it('loadConfig throws when required vars are missing', async () => {
    const { loadConfig } = await import('../config.js');

    delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    delete process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    delete process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];

    expect(() => loadConfig()).toThrow();
  });

  it('loadConfig parses comma-separated IDs', async () => {
    const { loadConfig } = await import('../config.js');

    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = 'waba1,waba2';
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = '123,456,789';

    const config = loadConfig();
    expect(config.allowedWabaIds).toEqual(['waba1', 'waba2']);
    expect(config.allowedPhoneNumberIds).toEqual(['123', '456', '789']);
  });
});
