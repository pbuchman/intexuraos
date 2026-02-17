import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('VM_CONFIG', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use default values when env vars are not set', async () => {
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_VM_ZONE'];
    delete process.env['INTEXURAOS_VM_INSTANCE_NAME'];
    delete process.env['INTEXURAOS_VM_HEALTH_URL'];
    delete process.env['INTEXURAOS_VM_SHUTDOWN_URL'];

    const { VM_CONFIG } = await import('../config.js');

    expect(VM_CONFIG.PROJECT_ID).toBe('intexuraos');
    expect(VM_CONFIG.ZONE).toBe('europe-central2-a');
    expect(VM_CONFIG.INSTANCE_NAME).toBe('cc-vm');
    expect(VM_CONFIG.HEALTH_ENDPOINT).toBe('https://cc-vm.intexuraos.cloud/health');
    expect(VM_CONFIG.SHUTDOWN_ENDPOINT).toBe('https://cc-vm.intexuraos.cloud/admin/shutdown');
    expect(VM_CONFIG.HEALTH_POLL_INTERVAL_MS).toBe(10_000);
    expect(VM_CONFIG.HEALTH_POLL_TIMEOUT_MS).toBe(180_000);
    expect(VM_CONFIG.SHUTDOWN_GRACE_PERIOD_MS).toBe(600_000);
    expect(VM_CONFIG.SHUTDOWN_POLL_INTERVAL_MS).toBe(30_000);
    expect(VM_CONFIG.ORCHESTRATOR_UNRESPONSIVE_TIMEOUT_MS).toBe(120_000);
  });

  it('should use custom values from env vars when set', async () => {
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'custom-project';
    process.env['INTEXURAOS_VM_ZONE'] = 'us-east1-b';
    process.env['INTEXURAOS_VM_INSTANCE_NAME'] = 'custom-vm';
    process.env['INTEXURAOS_VM_HEALTH_URL'] = 'https://custom.example.com/health';
    process.env['INTEXURAOS_VM_SHUTDOWN_URL'] = 'https://custom.example.com/shutdown';

    vi.resetModules();
    const { VM_CONFIG } = await import('../config.js');

    expect(VM_CONFIG.PROJECT_ID).toBe('custom-project');
    expect(VM_CONFIG.ZONE).toBe('us-east1-b');
    expect(VM_CONFIG.INSTANCE_NAME).toBe('custom-vm');
    expect(VM_CONFIG.HEALTH_ENDPOINT).toBe('https://custom.example.com/health');
    expect(VM_CONFIG.SHUTDOWN_ENDPOINT).toBe('https://custom.example.com/shutdown');
  });
});
