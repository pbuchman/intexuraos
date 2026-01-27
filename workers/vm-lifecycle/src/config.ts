export const VM_CONFIG = {
  PROJECT_ID: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? 'intexuraos',
  ZONE: process.env['INTEXURAOS_VM_ZONE'] ?? 'europe-central2-a',
  INSTANCE_NAME: process.env['INTEXURAOS_VM_INSTANCE_NAME'] ?? 'cc-vm',
  HEALTH_ENDPOINT:
    process.env['INTEXURAOS_VM_HEALTH_URL'] ?? 'https://cc-vm.intexuraos.cloud/health',
  SHUTDOWN_ENDPOINT:
    process.env['INTEXURAOS_VM_SHUTDOWN_URL'] ?? 'https://cc-vm.intexuraos.cloud/admin/shutdown',

  HEALTH_POLL_INTERVAL_MS: 10_000,
  HEALTH_POLL_TIMEOUT_MS: 180_000,
  SHUTDOWN_GRACE_PERIOD_MS: 600_000,
  SHUTDOWN_POLL_INTERVAL_MS: 30_000,
  ORCHESTRATOR_UNRESPONSIVE_TIMEOUT_MS: 120_000,
} as const;
