import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const deployScript = join(repoRoot, 'scripts/home-prod/deploy-release.sh');
const launcherScript = join(repoRoot, 'scripts/home-prod/root-launcher.sh');
const realGit = '/usr/bin/git';
const BASIC_SERVICE_NAMES = [
  'app-settings-service',
  'notion-service',
  'whatsapp-service',
  'mobile-notifications-service',
  'fishing-assistant-service',
  'notes-agent',
  'bookmarks-agent',
  'code-agent',
  'hellscript-agent',
  'llm-usage-service',
  'intex-agent',
  'user-service',
  'image-service',
  'calendar-agent',
  'linear-agent',
  'web-agent',
  'api-docs-hub',
] as const;

interface DeploymentFixture {
  candidate: string;
  clone: string;
  deployHome: string;
  expectedPm2Home: string;
  log: string;
  oldCodeRelease: string;
  oldWebRelease: string;
  origin: string;
  root: string;
  sha: string;
  webCurrent: string;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(realGit, args, { cwd, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function executable(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function deploymentFixture(
  options: {
    candidateFails?: boolean;
    foreignPort?: boolean;
    occupiedPort?: boolean;
    ownOccupiedPort?: boolean;
    wrongServiceSet?: boolean;
  } = {}
): DeploymentFixture {
  const root = mkdtempSync(join(tmpdir(), 'home-prod-deploy-'));
  const origin = join(root, 'origin.git');
  const source = join(root, 'source');
  const deployHome = join(root, 'home');
  const clone = join(deployHome, 'deploy', 'intexuraos');
  const log = join(root, 'calls.log');
  const candidate = join(root, 'candidate.json');
  const expectedPm2Home = join(deployHome, '.pm2-intexuraos-prod');
  const webReleases = join(root, 'web', 'releases');
  const webCurrent = join(root, 'web', 'current');
  const codeReleases = join(deployHome, 'deploy', 'releases');
  const codeCurrent = join(deployHome, 'deploy', 'current');
  const oldCodeRelease = join(codeReleases, 'a'.repeat(40));
  const oldWebRelease = join(webReleases, 'a'.repeat(40));

  mkdirSync(source, { recursive: true });
  mkdirSync(join(source, 'scripts', 'home-prod'), { recursive: true });
  mkdirSync(join(source, 'scripts', 'home-prod'), { recursive: true });
  copyFileSync(
    join(repoRoot, 'scripts', 'home-prod', 'validate-port-ownership.mjs'),
    join(source, 'scripts', 'home-prod', 'validate-port-ownership.mjs')
  );
  const fixtureApps = BASIC_SERVICE_NAMES.map((name, index) => ({
    name:
      options.wrongServiceSet === true && index === BASIC_SERVICE_NAMES.length - 1
        ? 'research-agent'
        : name,
    env: {
      HOST: '127.0.0.1',
      PORT: String(options.foreignPort === true && index === 0 ? 8110 : 18110 + index),
    },
  }));
  writeFileSync(
    join(source, 'ecosystem.config.prod.cjs'),
    `module.exports=${JSON.stringify({ apps: fixtureApps })};\n`
  );
  writeFileSync(join(source, 'package.json'), '{"name":"fixture","scripts":{"build":"true"}}\n');
  writeFileSync(join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  executable(
    join(source, 'scripts', 'home-prod', 'load-secrets.sh'),
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf 'loader:%s\\n' "$*" >> "$HOME_PROD_TEST_LOG"\nprintf 'loader-cwd:%s\\n' "$PWD" >> "$HOME_PROD_TEST_LOG"\nif [[ "$*" == *--validate-only* && ( "${options.candidateFails === true ? '1' : '0'}" == 1 || "\${CANDIDATE_FAIL:-0}" == 1 ) ]]; then exit 23; fi\noutput=''; payload=''\nwhile (($#)); do case "$1" in --candidate-output) output="$2"; shift 2;; --payload-file) payload="$2"; shift 2;; *) shift;; esac; done\n[[ -f "$payload" ]] || exit 45\nprintf 'payload-mode:%s\\n' "$(stat -c '%a' "$payload")" >> "$HOME_PROD_TEST_LOG"\nif [[ -n "$output" ]]; then printf 'INTEXURAOS_AUTH0_DOMAIN="fixture.example"\\n' > "$output/.env.prod"; chmod 600 "$output/.env.prod"; fi\n`
  );
  executable(
    join(source, 'scripts', 'home-prod', 'deploy-web.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nroot=""; env_file=""; profile=""\nwhile (($#)); do case "$1" in --web-root) root="$2"; shift 2;; --env-file) env_file="$2"; shift 2;; --public-deployment-profile) profile="$2"; shift 2;; *) shift;; esac; done\n[[ -f "$env_file" ]] || exit 44\n[[ "$profile" == basic ]] || exit 46\n[[ "${SOURCE_DATE_EPOCH:-}" =~ ^[1-9][0-9]*$ ]] || exit 47\nmkdir -p "$root"\nprintf "<html>candidate:%s:%s:%s</html>\\n" "$SOURCE_DATE_EPOCH" "$profile" "${PUBLIC_CONFIG_VARIANT:-stable}" > "$root/index.html"\nprintf "web:%s:%s:%s\\n" "$env_file" "$SOURCE_DATE_EPOCH" "$profile" >> "$HOME_PROD_TEST_LOG"\n'
  );
  executable(
    join(source, 'scripts', 'home-prod', 'reload-pm2.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "reload:%s\\n" "$PM2_HOME" >> "$HOME_PROD_TEST_LOG"\nif [[ "${RELOAD_FAIL:-0}" == 1 ]]; then exit 71; fi\nprintf "verified-new-release\\n" > "$PM2_HOME/dump.pm2"\n'
  );

  git(root, 'init', '--bare', origin);
  git(source, 'init', '-b', 'development');
  git(source, 'config', 'user.email', 'test@example.com');
  git(source, 'config', 'user.name', 'Test');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'fixture');
  git(source, 'remote', 'add', 'origin', origin);
  git(source, 'push', '-u', 'origin', 'development');
  const sha = git(source, 'rev-parse', 'HEAD');

  mkdirSync(join(deployHome, 'deploy'), { recursive: true });
  mkdirSync(expectedPm2Home, { recursive: true });
  writeFileSync(join(expectedPm2Home, 'dump.pm2'), 'verified-old-release\n');
  git(root, 'clone', '--branch', 'development', origin, clone);
  mkdirSync(oldCodeRelease, { recursive: true });
  mkdirSync(oldWebRelease, { recursive: true });
  writeFileSync(join(oldCodeRelease, 'marker'), 'running\n');
  writeFileSync(join(oldWebRelease, 'index.html'), 'running\n');
  symlinkSync(oldCodeRelease, codeCurrent);
  mkdirSync(join(root, 'web'), { recursive: true });
  symlinkSync(oldWebRelease, webCurrent);
  writeFileSync(candidate, 'TOP-SECRET-CANDIDATE\n', { mode: 0o400 });

  const bin = join(root, 'bin');
  mkdirSync(bin);
  executable(
    join(bin, 'pnpm'),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "pnpm:%s\\n" "$*" >> "$HOME_PROD_TEST_LOG"\n'
  );
  executable(
    join(bin, 'pm2'),
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf "pm2:%s:%s\\n" "$PM2_HOME" "$*" >> "$HOME_PROD_TEST_LOG"\nif [[ "\${1:-}" == jlist ]]; then printf '${options.ownOccupiedPort === true ? `[{"pid":${String(process.pid)}}]` : '[]'}\\n'; fi\n`
  );
  executable(
    join(bin, 'ss'),
    `#!/usr/bin/env bash\nset -euo pipefail\n${options.occupiedPort === true ? "printf '%s\\n' 'LISTEN 0 511 127.0.0.1:18110 0.0.0.0:* users:((\"foreign\",pid=999,fd=3))'" : options.ownOccupiedPort === true ? `printf '%s\\n' 'LISTEN 0 511 127.0.0.1:18110 0.0.0.0:* users:(("node",pid=${String(process.pid)},fd=3))'` : ':'}\n`
  );
  if (options.ownOccupiedPort === true) {
    mkdirSync(expectedPm2Home, { recursive: true });
    writeFileSync(join(expectedPm2Home, 'pm2.pid'), `${String(process.pid)}\n`);
  }

  return {
    candidate,
    clone,
    deployHome,
    expectedPm2Home,
    log,
    oldCodeRelease,
    oldWebRelease,
    origin,
    root,
    sha,
    webCurrent,
  };
}

function runDeployment(
  input: DeploymentFixture,
  env: Record<string, string> = {}
): SpawnSyncReturns<string> {
  return spawnSync('bash', [deployScript, input.sha, '4', input.candidate], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOY_HOME: input.deployHome,
      DEPLOY_USER: process.env.USER ?? 'pbuchman',
      HOME: input.deployHome,
      HOME_PROD_TEST_LOG: input.log,
      PATH: `${join(input.root, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`,
      PM2_HOME: input.expectedPm2Home,
      REPO_DIR: input.clone,
      WEB_CURRENT_LINK: input.webCurrent,
      WEB_RELEASES_ROOT: join(input.root, 'web', 'releases'),
      ...env,
    },
  });
}

describe('Home PROD privileged launcher input boundary', () => {
  it.each([
    ['short SHA', ['abc', '4']],
    ['uppercase SHA', ['A'.repeat(40), '4']],
    ['mutable secret version', ['a'.repeat(40), 'latest']],
    ['zero secret version', ['a'.repeat(40), '0']],
    ['extra argument', ['a'.repeat(40), '4', 'extra']],
  ])('rejects %s before privileged work', (_label, args) => {
    const result = spawnSync('bash', [launcherScript, ...args], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('TOP-SECRET');
  });

  it('starts and verifies the dedicated service before any PM2 client command', () => {
    const source = readFileSync(launcherScript, 'utf8');
    const start = source.lastIndexOf('systemctl start "${SYSTEMD_UNIT}"');
    const active = source.lastIndexOf('systemctl is-active --quiet "${SYSTEMD_UNIT}"');
    const deploy = source.lastIndexOf('run_user_deployment "$1" "$2"');
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(active);
    expect(active).toBeLessThan(deploy);
    expect(source).toContain('systemctl show "${SYSTEMD_UNIT}" --property=ControlGroup --value');
    expect(source).toContain('"/proc/${daemon_pid}/cgroup"');
    expect(source.lastIndexOf('ensure_pm2_service')).toBeLessThan(deploy);
  });
});

describe('Home PROD release deployment', () => {
  it('rejects a dirty canonical clone before preparing a release', () => {
    const input = deploymentFixture();
    writeFileSync(join(input.clone, 'operator-note.txt'), 'preserve me\n');

    const result = runDeployment(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Deployment clone is not clean');
    expect(existsSync(input.log)).toBe(false);
  });

  it('rejects a release that binds outside the reserved loopback 181xx ports', () => {
    const input = deploymentFixture({ foreignPort: true });

    const result = runDeployment(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('reserved Home PROD loopback port');
    const trace = readFileSync(input.log, 'utf8');
    expect(trace).not.toContain('pm2:');
    expect(readlinkSync(join(input.deployHome, 'deploy', 'current'))).toBe(input.oldCodeRelease);
  });

  it('rejects an occupied candidate port owned outside the dedicated PM2 daemon', () => {
    const input = deploymentFixture({ occupiedPort: true });

    const result = runDeployment(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('occupied without the dedicated PM2 daemon');
    const trace = readFileSync(input.log, 'utf8');
    expect(trace).not.toContain(':stop all');
    expect(readlinkSync(join(input.deployHome, 'deploy', 'current'))).toBe(input.oldCodeRelease);
  });

  it('does not trust a listener merely because its pid is reported by PM2', () => {
    const input = deploymentFixture({ ownOccupiedPort: true });

    const result = runDeployment(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('occupied by a foreign process');
    expect(readFileSync(input.log, 'utf8')).not.toContain(`pm2:${input.expectedPm2Home}:stop all`);
  });

  it('rejects a service set other than the exact 17-app basic profile', () => {
    const input = deploymentFixture({ wrongServiceSet: true });

    const result = runDeployment(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('exact Home PROD basic service set');
    expect(readFileSync(input.log, 'utf8')).not.toContain(':stop all');
  });

  it('keeps the running code and web pointers when candidate admission fails', () => {
    const input = deploymentFixture({ candidateFails: true });

    const result = runDeployment(input);

    expect(result.status).not.toBe(0);
    const trace = readFileSync(input.log, 'utf8');
    expect(trace).toContain('--validate-only');
    expect(trace).not.toContain('pm2:');
    expect(trace).not.toContain('reload:');
    expect(readlinkSync(join(input.deployHome, 'deploy', 'current'))).toBe(input.oldCodeRelease);
    expect(readlinkSync(input.webCurrent)).toBe(input.oldWebRelease);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('TOP-SECRET-CANDIDATE');
  });

  it('rejects a foreign PM2 home before any candidate or runtime operation', () => {
    const input = deploymentFixture();

    const result = runDeployment(input, { PM2_HOME: join(input.deployHome, '.pm2') });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PM2_HOME must be');
    expect(existsSync(input.log)).toBe(false);
  });

  it('stages, validates, then switches only the dedicated release and PM2 state', () => {
    const input = deploymentFixture();

    const result = runDeployment(input);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const activeCode = readlinkSync(join(input.deployHome, 'deploy', 'current'));
    expect(basename(activeCode)).toMatch(new RegExp(`^${input.sha}\\.[A-Za-z0-9]+$`, 'u'));
    expect(existsSync(activeCode)).toBe(true);
    expect(basename(readlinkSync(input.webCurrent))).toBe(input.sha);
    const trace = readFileSync(input.log, 'utf8');
    expect(trace.indexOf('--validate-only')).toBeLessThan(trace.indexOf('reload:'));
    expect(trace).toContain('pnpm:install --frozen-lockfile');
    expect(trace).toContain('pnpm:--recursive --filter !@intexuraos/web --if-present run build');
    expect(trace).toMatch(/web:.*candidate\.[^/]+\/projection\/\.env\.prod/u);
    expect(trace).toContain('payload-mode:600');
    expect(trace).toMatch(/loader-cwd:.*\/deploy\/releases\/[0-9a-f]{40}\.[^/]+$/mu);
    expect(trace).not.toContain(`pm2:${input.expectedPm2Home}:stop all`);
    expect(trace).toContain(`reload:${input.expectedPm2Home}`);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('TOP-SECRET-CANDIDATE');
  });

  it('does not remove an existing stable release when a redeploy candidate fails', () => {
    const input = deploymentFixture();
    const first = runDeployment(input);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const stableRelease = readlinkSync(join(input.deployHome, 'deploy', 'current'));
    const stableWeb = join(input.root, 'web', 'releases', input.sha);
    writeFileSync(join(stableRelease, 'retained-marker'), 'keep\n');
    writeFileSync(join(stableWeb, 'retained-marker'), 'keep-web\n');

    const retry = runDeployment(input, { CANDIDATE_FAIL: '1' });

    expect(retry.status).not.toBe(0);
    expect(readFileSync(join(stableRelease, 'retained-marker'), 'utf8')).toBe('keep\n');
    expect(readFileSync(join(stableWeb, 'retained-marker'), 'utf8')).toBe('keep-web\n');
    expect(readlinkSync(join(input.deployHome, 'deploy', 'current'))).toBe(stableRelease);
  });

  it('leaves a failed activation stopped and recoverable by the next admitted deployment', () => {
    const input = deploymentFixture();

    const failed = runDeployment(input, { RELOAD_FAIL: '1' });

    expect(failed.status).not.toBe(0);
    expect(readlinkSync(join(input.deployHome, 'deploy', 'current'))).toBe(input.oldCodeRelease);
    expect(readlinkSync(input.webCurrent)).toBe(input.oldWebRelease);
    expect(existsSync(join(input.expectedPm2Home, 'dump.pm2'))).toBe(false);

    const retry = runDeployment(input);
    expect(retry.status, `${retry.stdout}\n${retry.stderr}`).toBe(0);
    expect(readlinkSync(join(input.deployHome, 'deploy', 'current'))).not.toBe(
      input.oldCodeRelease
    );
    expect(existsSync(join(input.expectedPm2Home, 'dump.pm2'))).toBe(true);
  });

  it('rebuilds the same SHA reproducibly and rejects changed public configuration', () => {
    const input = deploymentFixture();
    const first = runDeployment(input);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const stableWeb = join(input.root, 'web', 'releases', input.sha, 'index.html');
    const original = readFileSync(stableWeb, 'utf8');
    const firstCodeAttempt = readlinkSync(join(input.deployHome, 'deploy', 'current'));

    const same = runDeployment(input);
    expect(same.status, `${same.stdout}\n${same.stderr}`).toBe(0);
    expect(readFileSync(stableWeb, 'utf8')).toBe(original);
    expect(readlinkSync(join(input.deployHome, 'deploy', 'current'))).not.toBe(firstCodeAttempt);

    const changed = runDeployment(input, { PUBLIC_CONFIG_VARIANT: 'changed' });
    expect(changed.status).not.toBe(0);
    expect(changed.stderr).toContain('Existing web release differs');
    expect(readFileSync(stableWeb, 'utf8')).toBe(original);
  });
});
