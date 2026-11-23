import { chmodSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BootstrapEnvConfig } from './env-config.js';

const PROJECTION_FILENAME = 'error-hub-probe-runtime.json';

export function writeErrorHubProbeRuntime(
  stateDir: string,
  env: Pick<BootstrapEnvConfig, 'workerImage' | 'errorHubHost' | 'errorHubConnectAddress'>
): void {
  const projection = {
    schemaVersion: 1,
    imageRef: env.workerImage,
    errorHubHost: env.errorHubHost,
    connectAddress: env.errorHubConnectAddress ?? null,
    invocationId: process.env['INVOCATION_ID'] ?? null,
  };
  const temporaryDirectory = mkdtempSync(join(stateDir, '.error-hub-probe-runtime-'));
  try {
    const temporaryPath = join(temporaryDirectory, PROJECTION_FILENAME);
    writeFileSync(temporaryPath, `${JSON.stringify(projection)}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, join(stateDir, PROJECTION_FILENAME));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
