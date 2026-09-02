import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HOOK_PATH = fileURLToPath(new URL('../pre-tool-policy.sh', import.meta.url));

interface HookResult {
  status: number | null;
  stderr: string;
}

function runHook(command: string, tempHome: string): HookResult {
  const result = spawnSync('bash', [HOOK_PATH], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, HOME: tempHome, TMPDIR: tempHome },
  });

  return { status: result.status, stderr: result.stderr };
}

describe('Codex infrastructure pre-tool policy', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'codex-hook-policy-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it.each([
    { command: 'terraform apply', allowed: false },
    { command: 'gcloud run deploy api', allowed: false },
    { command: 'gcloud pubsub topics create events', allowed: false },
    { command: 'gcloud run services describe api', allowed: true },
    { command: 'pnpm run ci:tracked', allowed: true },
  ])('$command allowed=$allowed', ({ command, allowed }) => {
    const result = runHook(command, tempHome);

    expect(result.status).toBe(allowed ? 0 : 2);
    if (allowed) {
      expect(result.stderr).toBe('');
    } else {
      expect(result.stderr).toContain('BLOCKED:');
    }
  });

  it('allows Terraform when every emulator variable is explicitly cleared', () => {
    const result = runHook(
      'STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform plan',
      tempHome
    );

    expect(result).toEqual({ status: 0, stderr: '' });
  });

  it('does not create runtime artifacts', () => {
    runHook('gcloud run deploy api', tempHome);

    expect(readdirSync(tempHome)).toEqual([]);
  });
});
