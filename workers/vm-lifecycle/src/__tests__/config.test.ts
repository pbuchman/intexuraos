import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REQUIRED_VARS = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_VM_ZONE',
  'INTEXURAOS_VM_INSTANCE_NAME',
  'INTEXURAOS_VM_HEALTH_URL',
  'INTEXURAOS_VM_SHUTDOWN_URL',
] as const;

function setAllRequired(): void {
  process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
  process.env['INTEXURAOS_VM_ZONE'] = 'test-zone';
  process.env['INTEXURAOS_VM_INSTANCE_NAME'] = 'test-vm';
  process.env['INTEXURAOS_VM_HEALTH_URL'] = 'https://test.example.com/health';
  process.env['INTEXURAOS_VM_SHUTDOWN_URL'] = 'https://test.example.com/shutdown';
}

describe('VM_CONFIG', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('exposes env-driven values when all required vars are set', async () => {
    setAllRequired();

    const { VM_CONFIG } = await import('../config.js');

    expect(VM_CONFIG.PROJECT_ID).toBe('test-project');
    expect(VM_CONFIG.ZONE).toBe('test-zone');
    expect(VM_CONFIG.INSTANCE_NAME).toBe('test-vm');
    expect(VM_CONFIG.HEALTH_ENDPOINT).toBe('https://test.example.com/health');
    expect(VM_CONFIG.SHUTDOWN_ENDPOINT).toBe('https://test.example.com/shutdown');
  });

  it('keeps numeric timeout constants at expected literal values', async () => {
    setAllRequired();

    const { VM_CONFIG } = await import('../config.js');

    expect(VM_CONFIG.HEALTH_POLL_INTERVAL_MS).toBe(10_000);
    expect(VM_CONFIG.HEALTH_POLL_TIMEOUT_MS).toBe(180_000);
    expect(VM_CONFIG.SHUTDOWN_GRACE_PERIOD_MS).toBe(600_000);
    expect(VM_CONFIG.SHUTDOWN_POLL_INTERVAL_MS).toBe(30_000);
    expect(VM_CONFIG.ORCHESTRATOR_UNRESPONSIVE_TIMEOUT_MS).toBe(120_000);
  });

  for (const missing of REQUIRED_VARS) {
    it(`throws at module load when ${missing} is missing (regression — no silent fallback)`, async () => {
      setAllRequired();
      Reflect.deleteProperty(process.env, missing);

      await expect(import('../config.js')).rejects.toThrow(new RegExp(missing));
    });

    it(`throws at module load when ${missing} is an empty string`, async () => {
      setAllRequired();
      process.env[missing] = '';

      await expect(import('../config.js')).rejects.toThrow(new RegExp(missing));
    });
  }
});
