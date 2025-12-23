/**
 * Tests for config validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config validation', () => {
  let savedVerify: string | undefined;
  let savedSecret: string | undefined;
  let savedAccess: string | undefined;
  let savedPhone: string | undefined;

  beforeEach(() => {
    savedVerify = process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    savedSecret = process.env['PRAXOS_WHATSAPP_APP_SECRET'];
    savedAccess = process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'];
    savedPhone = process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'];
  });

  afterEach(() => {
    // Restore
    if (savedVerify !== undefined) {
      process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = savedVerify;
    } else {
      delete process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    }
    if (savedSecret !== undefined) {
      process.env['PRAXOS_WHATSAPP_APP_SECRET'] = savedSecret;
    } else {
      delete process.env['PRAXOS_WHATSAPP_APP_SECRET'];
    }
    if (savedAccess !== undefined) {
      process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'] = savedAccess;
    } else {
      delete process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'];
    }
    if (savedPhone !== undefined) {
      process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'] = savedPhone;
    } else {
      delete process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'];
    }
  });

  it('validates required env vars', async () => {
    const { validateConfigEnv } = await import('../config.js');

    delete process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_APP_SECRET'];

    const missing = validateConfigEnv();
    expect(missing).toContain('PRAXOS_WHATSAPP_VERIFY_TOKEN');
    expect(missing).toContain('PRAXOS_WHATSAPP_APP_SECRET');
  });

  it('returns empty array when all required vars present', async () => {
    const { validateConfigEnv } = await import('../config.js');

    process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['PRAXOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'] = 'test';

    const missing = validateConfigEnv();
    expect(missing).toHaveLength(0);
  });

  it('treats empty string as missing', async () => {
    const { validateConfigEnv } = await import('../config.js');

    process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = '';
    process.env['PRAXOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'] = 'test';

    const missing = validateConfigEnv();
    expect(missing).toContain('PRAXOS_WHATSAPP_VERIFY_TOKEN');
  });

  it('loadConfig throws when required vars are missing', async () => {
    const { loadConfig } = await import('../config.js');

    delete process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_APP_SECRET'];
    delete process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'];

    expect(() => loadConfig()).toThrow();
  });

  it('loadConfig parses comma-separated phone number IDs', async () => {
    const { loadConfig } = await import('../config.js');

    process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['PRAXOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'] = '123,456,789';

    const config = loadConfig();
    expect(config.allowedPhoneNumberIds).toEqual(['123', '456', '789']);
  });
});
