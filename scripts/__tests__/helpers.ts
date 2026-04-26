/**
 * Shared test helpers for the parity verifier scripts.
 *
 * Each verify-*.test.ts builds a temporary "synthetic repo" with a tiny
 * subset of the directory layout (terraform/environments/dev, apps/, scripts/
 * __fixtures__) and invokes the script with INTEXURAOS_VERIFY_REPO_ROOT
 * pointing at the temp dir.
 *
 * createBaseSynthRepo() returns the common skeleton + helpers; per-script
 * tests layer on additional helpers (e.g. writeApp, writeEcosystem) at the
 * call site.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface BaseSynthRepo {
  root: string;
  writeTf(filename: string, content: string): void;
  writeKnownDrift(content: object): void;
}

export const EMPTY_DRIFT = {
  terraformEnvConsumers: {},
  ecosystemCoverage: { missingEcosystemEntry: {}, missingValidateRequiredEnv: {} },
  terraformSecretMounts: {},
};

export function createBaseSynthRepo(prefix: string): BaseSynthRepo {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'terraform', 'environments', 'dev'), { recursive: true });
  mkdirSync(join(root, 'scripts', '__fixtures__'), { recursive: true });

  return {
    root,
    writeTf(filename, content) {
      writeFileSync(join(root, 'terraform', 'environments', 'dev', filename), content);
    },
    writeKnownDrift(content) {
      writeFileSync(
        join(root, 'scripts', '__fixtures__', 'known-drift.json'),
        JSON.stringify(content, null, 2)
      );
    },
  };
}

export interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runScript(scriptName: string, repoRoot: string): ScriptResult {
  const scriptPath = join(process.cwd(), 'scripts', scriptName);
  const result = spawnSync('node', [scriptPath], {
    encoding: 'utf8',
    env: { ...process.env, INTEXURAOS_VERIFY_REPO_ROOT: repoRoot },
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
