import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runHomeDevRuntimeCommand,
  sanitizeHomeDevRuntimeEnvironment,
} from '../run-home-dev-runtime-command.mjs';

const repoRoot = resolve(__dirname, '..', '..');

describe('Home Dev runtime command wrapper', () => {
  it('runs normally away from a host with the Home Dev mode record', () => {
    const result = runHomeDevRuntimeCommand(
      process.execPath,
      ['-e', 'process.stdout.write("local-ok")'],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('local-ok');
  });

  it('holds the shared host lock while it rechecks mode and runs the child', () => {
    const source = readFileSync(
      resolve(repoRoot, 'scripts/run-home-dev-runtime-command.mjs'),
      'utf8'
    );
    expect(source).toContain("'/usr/bin/flock'");
    expect(source).toContain("'--shared'");
    expect(source).toContain('HOME_DEV_RUNTIME_START_LOCK');
    expect(source).toContain('assertScriptPath');
    expect(source).toContain('lockedCommandScript');
    expect(source).toContain('|| exit "$?"');
    expect(source).toContain('exec "$@"');
    expect(source).not.toContain('--intexuraos-inside-runtime-start-lock');
  });

  it('removes every imported Bash function and shell startup control variable', () => {
    const environment = sanitizeHomeDevRuntimeEnvironment({
      SAFE_VALUE: 'retained',
      BASH_ENV: '/tmp/hostile-bash-env',
      ENV: '/tmp/hostile-env',
      SHELLOPTS: 'errexit',
      BASHOPTS: 'extdebug',
      'BASH_FUNC_set%%': '() { return 0; }',
      'BASH_FUNC_exec%%': '() { return 0; }',
      'BASH_FUNC_shift%%': '() { return 0; }',
    });

    expect(environment).toEqual({ SAFE_VALUE: 'retained' });
  });

  it('fails closed on every inspection error except genuine lock-and-state absence', () => {
    const source = readFileSync(
      resolve(repoRoot, 'scripts/run-home-dev-runtime-command.mjs'),
      'utf8'
    );
    expect(source).toContain("if (error?.code === 'ENOENT') return null");
    expect(source).toContain('lockMetadata === null && stateMetadata === null');
    expect(source).toContain('runtime lock is missing');
  });
});
