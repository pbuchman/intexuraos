export const CONFIG = {
  PROJECT_ID: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
  REGION: process.env['INTEXURAOS_GCP_REGION'] ?? '',
  ZONE: process.env['INTEXURAOS_GCP_ZONE'] ?? '',
  MIG_NAME: process.env['INTEXURAOS_MIG_NAME'] ?? '',
  ENVIRONMENT: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'dev',
  IDLE_TIMEOUT_MINUTES: parseInt(process.env['IDLE_TIMEOUT_MINUTES'] ?? '30', 10),
} as const;
