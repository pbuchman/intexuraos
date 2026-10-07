import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const homeProd = resolve(repoRoot, 'scripts/home-prod');

const activeHelpers = [
  'deploy-web.sh',
  'load-secrets.sh',
  'reload-pm2.sh',
  'validate-prod-secret-candidate.sh',
  'verify-secret-package-version-pins.mjs',
  'verify-semantic-health.mjs',
  'nginx/intexuraos.conf',
  'nginx/jwt-verify.lua',
] as const;

describe('Home PROD runtime source boundary', () => {
  it('keeps active runtime helpers together and retires the Hetzner script tree', () => {
    for (const path of activeHelpers) {
      expect(existsSync(resolve(homeProd, path)), path).toBe(true);
    }
    expect(existsSync(resolve(repoRoot, 'scripts/hetzner'))).toBe(false);

    const deploy = readFileSync(resolve(homeProd, 'deploy-release.sh'), 'utf8');
    expect(deploy).not.toContain('scripts/hetzner');
    expect(deploy).toContain('scripts/home-prod/load-secrets.sh');
    expect(deploy).toContain('scripts/home-prod/deploy-web.sh');
    expect(deploy).toContain('scripts/home-prod/reload-pm2.sh');
  });

  it('renders exactly the seventeen basic PM2 apps as nginx upstreams at the same ports', () => {
    const rendered = execFileSync(
      process.execPath,
      [resolve(homeProd, 'render-edge.mjs'), 'nginx'],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    const config = execFileSync(
      process.execPath,
      ['-e', "process.stdout.write(JSON.stringify(require('./ecosystem.config.prod.cjs')))"],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: '/home/intexuraos-prod',
          INTEXURAOS_ENVIRONMENT: 'prod',
          INTEXURAOS_PROD_ENV_FILE: '/nonexistent/home-prod-test.env',
          INTEXURAOS_PROD_PORT_OFFSET: '10000',
          INTEXURAOS_PROD_PROFILE: 'basic',
        },
      }
    );
    const apps = (JSON.parse(config) as { apps: Array<{ name: string; env: { PORT: string } }> })
      .apps;
    const pm2 = new Map(
      apps.map((app) => [app.name.replaceAll('-', '_'), Number(app.env.PORT)] as const)
    );
    const nginx = new Map(
      [...rendered.matchAll(/^upstream ([a-z0-9_]+) \{ server 127\.0\.0\.1:(\d+);/gmu)].map(
        (match) => [match[1], Number(match[2])] as const
      )
    );

    expect(apps).toHaveLength(17);
    expect(nginx).toEqual(pm2);
  });

  it('deletes only the candidate app set when readiness fails after PM2 start', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'home-prod-readiness-'));
    const bin = join(scratch, 'bin');
    const state = join(scratch, 'candidate-running');
    const log = join(scratch, 'pm2.log');
    const config = join(scratch, 'ecosystem.cjs');
    const rendered = join(scratch, 'rendered.json');
    mkdirSync(bin);
    writeFileSync(
      config,
      `module.exports={apps:[{name:'probe',script:'/bin/true',env:{PORT:'18110'}}]};\n`
    );
    const executable = (name: string, source: string): void => {
      const path = join(bin, name);
      writeFileSync(path, source, { mode: 0o700 });
      chmodSync(path, 0o700);
    };
    executable(
      'pm2',
      `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "$*" >> '${log}'\ncase "\${1:-}" in\n  start) : > '${state}' ;;\n  delete) rm -f -- '${state}' ;;\n  jlist) printf '[{"name":"probe","pm2_env":{"status":"online"}}]\\n' ;;\n  save) printf 'unexpected-save\\n' >> '${log}' ;;\nesac\n`
    );
    executable('curl', '#!/usr/bin/env bash\nexit 22\n');
    executable('sleep', '#!/usr/bin/env bash\n/bin/sleep 0.05\n');

    try {
      const result = spawnSync(
        'bash',
        [resolve(homeProd, 'reload-pm2.sh'), '--config', config, '--rendered-config', rendered],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: scratch,
            INTEXURAOS_COMMIT_SHA: 'a'.repeat(40),
            INTEXURAOS_ENVIRONMENT: 'prod',
            PATH: `${bin}:/usr/bin:/bin`,
            PM2_HEALTH_CONSECUTIVE_SUCCESSES: '1',
            PM2_HEALTH_URLS: 'probe|http://127.0.0.1:1/health',
            PM2_HOME: join(scratch, 'pm2'),
            PM2_START_TIMEOUT_SECONDS: '1',
          },
          timeout: 10_000,
        }
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
      expect(existsSync(state)).toBe(false);
      const calls = readFileSync(log, 'utf8').trim().split('\n');
      const start = calls.findIndex((call) => call.startsWith('start '));
      const cleanup = calls.findLastIndex((call) => call.startsWith('delete '));
      expect(start).toBeGreaterThan(-1);
      expect(cleanup).toBeGreaterThan(start);
      expect(calls).not.toContain('unexpected-save');
      expect(calls.filter((call) => call.startsWith('delete '))).toEqual([
        `delete ${rendered}`,
        `delete ${rendered}`,
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('documents the fail-closed activation state and legal retry path', () => {
    const runbook = readFileSync(resolve(repoRoot, 'docs/operations/home-prod-runbook.md'), 'utf8');
    expect(runbook).toMatch(/removes the saved PM2 dump before\s+publishing the new projection/u);
    expect(runbook).toMatch(/restores the previous code and web links/u);
    expect(runbook).toMatch(/next admitted\s+deployment/u);
    expect(runbook).toMatch(/must not run `pm2 resurrect` manually/u);
  });
});
