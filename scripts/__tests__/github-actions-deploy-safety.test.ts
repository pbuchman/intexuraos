import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const deployPath = resolve(repoRoot, 'scripts/hetzner/github-actions-deploy.sh');
const temporaryDirectories: string[] = [];
const candidateSha = 'a'.repeat(40);
const previousCodeSha = 'b'.repeat(40);
const failedSha = 'd'.repeat(40);
const nextSha = 'e'.repeat(40);

interface ReleaseFixture {
  codeCurrent: string;
  codeReleases: string;
  healthySha: string;
  root: string;
  tracePath: string;
  webCurrent: string;
  webReleases: string;
}

function releaseFixture(): ReleaseFixture {
  const root = mkdtempSync(join(tmpdir(), 'intexuraos-deploy-recovery-'));
  temporaryDirectories.push(root);
  const codeRoot = join(root, 'code');
  const webRoot = join(root, 'web');
  const codeReleases = join(codeRoot, 'releases');
  const webReleases = join(webRoot, 'releases');
  const codeCurrent = join(codeRoot, 'current');
  const webCurrent = join(webRoot, 'current');
  const healthySha = 'f'.repeat(40);
  mkdirSync(join(codeReleases, healthySha), { recursive: true });
  mkdirSync(join(webReleases, healthySha), { recursive: true });
  symlinkSync(join(codeReleases, healthySha), codeCurrent);
  symlinkSync(join(webReleases, healthySha), webCurrent);
  return {
    codeCurrent,
    codeReleases,
    healthySha,
    root,
    tracePath: join(root, 'attempts.txt'),
    webCurrent,
    webReleases,
  };
}

function runReleaseAttempt(input: ReleaseFixture, sha: string, failAfterSwitch: boolean) {
  mkdirSync(join(input.codeReleases, sha), { recursive: true });
  const harness = `
set -euo pipefail
source "$1"
COMMIT_SHA_VALUE="$2"
COMMIT_MESSAGE_VALUE='recovery sequence'
SECRET_PACKAGE_VERSION='17'
REMOTE_REPO_DIR="$3"
REMOTE_RELEASE_DIR="$3/releases/$2"
DEPLOY_NGINX=false
code_current="$4"
code_releases="$5"
web_current="$6"
web_releases="$7"
trace_path="$8"
fail_after_switch="$9"
run_remote_at() {
  local directory="$1"
  local command="$2"
  printf '%s\\n' "$command" >> "$trace_path"
  if [[ "$command" == *'pm2 delete all'* ]]; then
    ln -sfn "$code_releases/$COMMIT_SHA_VALUE" "$code_current"
  elif [[ "$command" == *'deploy-web.sh'* ]]; then
    mkdir -p "$web_releases/$COMMIT_SHA_VALUE"
    ln -sfn "$web_releases/$COMMIT_SHA_VALUE" "$web_current"
  elif [[ "$command" == *'reload-pm2.sh'* && "$fail_after_switch" == true ]]; then
    return 24
  elif [[ "$command" == *prune* || "$command" == *rmSync* ]]; then
    rm -rf -- "$code_releases/${input.healthySha}" "$web_releases/${input.healthySha}"
  fi
}
deploy_release
`;
  return spawnSync(
    'bash',
    [
      '-c',
      harness,
      'deploy-recovery-harness',
      deployPath,
      sha,
      resolve(input.codeReleases, '..'),
      input.codeCurrent,
      input.codeReleases,
      input.webCurrent,
      input.webReleases,
      input.tracePath,
      String(failAfterSwitch),
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  );
}

function runDeployment(failValidation: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'intexuraos-deploy-safety-'));
  temporaryDirectories.push(root);
  const tracePath = join(root, 'trace.txt');
  const serviceStatePath = join(root, 'services');
  const activeSecretPath = join(root, 'active-package');
  const currentLink = join(root, 'current');
  const previousRelease = join(root, previousCodeSha);
  mkdirSync(previousRelease);
  writeFileSync(serviceStatePath, 'running\n');
  writeFileSync(activeSecretPath, 'package-v16\n');
  symlinkSync(previousRelease, currentLink);

  const harness = `
set -euo pipefail
source "$1"
COMMIT_SHA_VALUE='${candidateSha}'
COMMIT_MESSAGE_VALUE='safe release'
SECRET_PACKAGE_VERSION='17'
REMOTE_REPO_DIR='$2'
REMOTE_RELEASE_DIR='$2/releases/${candidateSha}'
DEPLOY_NGINX=false
fixture_root="$2"
trace_path="$3"
fail_validation="$4"
service_state_path="$5"
active_secret_path="$6"
run_remote_at() {
  local directory="$1"
  local command="$2"
  printf '%s\\n' "$command" >> "$trace_path"
  if [[ "$command" == *--validate-only* ]]; then
    [[ "$fail_validation" == true ]] && return 23
    return 0
  fi
  if [[ "$command" == *'pm2 delete all'* ]]; then
    printf 'stopped\\n' > "$service_state_path"
    ln -sfn "$fixture_root/releases/${candidateSha}" "$fixture_root/current"
  fi
  if [[ "$command" == *'load-secrets.sh --version'* && "$command" != *--validate-only* ]]; then
    printf 'package-v17\\n' > "$active_secret_path"
  fi
  return 0
}
deploy_release
`;
  const result = spawnSync(
    'bash',
    [
      '-c',
      harness,
      'deploy-harness',
      deployPath,
      root,
      tracePath,
      String(failValidation),
      serviceStatePath,
      activeSecretPath,
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  return { activeSecretPath, currentLink, result, serviceStatePath, tracePath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('GitHub Actions production deployment safety', () => {
  it('leaves the running release and active package untouched when candidate validation fails', () => {
    const run = runDeployment(true);

    expect(run.result.status).not.toBe(0);
    expect(readFileSync(run.serviceStatePath, 'utf8')).toBe('running\n');
    expect(readlinkSync(run.currentLink)).toContain(previousCodeSha);
    expect(readFileSync(run.activeSecretPath, 'utf8')).toBe('package-v16\n');
    const trace = readFileSync(run.tracePath, 'utf8');
    expect(trace).toContain('--validate-only');
    expect(trace).not.toContain('pm2 delete all');
    expect(trace).not.toContain('systemctl stop alloy.service');
  });

  it('validates before the destructive switch and publishes only after it on success', () => {
    const run = runDeployment(false);

    expect(run.result.status, run.result.stderr).toBe(0);
    const trace = readFileSync(run.tracePath, 'utf8');
    const validation = trace.indexOf('--validate-only');
    const shutdown = trace.indexOf('pm2 delete all');
    const publication = trace.indexOf('load-secrets.sh --version', validation + 1);
    expect(validation).toBeGreaterThanOrEqual(0);
    expect(validation).toBeLessThan(shutdown);
    expect(shutdown).toBeLessThan(publication);
    expect(readFileSync(run.serviceStatePath, 'utf8')).toBe('stopped\n');
    expect(readFileSync(run.activeSecretPath, 'utf8')).toBe('package-v17\n');
  });

  it.each([
    ['retrying the failed SHA', failedSha],
    ['deploying a new SHA', nextSha],
  ])('retains healthy release A after failed B and %s', (_label, followingSha) => {
    const input = releaseFixture();

    const failed = runReleaseAttempt(input, failedSha, true);
    expect(failed.status).not.toBe(0);
    expect(readlinkSync(input.codeCurrent)).toContain(failedSha);
    expect(readlinkSync(input.webCurrent)).toContain(failedSha);
    expect(existsSync(join(input.codeReleases, input.healthySha))).toBe(true);
    expect(existsSync(join(input.webReleases, input.healthySha))).toBe(true);

    const completed = runReleaseAttempt(input, followingSha, false);
    expect(completed.status, completed.stderr).toBe(0);
    expect(existsSync(join(input.codeReleases, input.healthySha))).toBe(true);
    expect(existsSync(join(input.webReleases, input.healthySha))).toBe(true);
    expect(readFileSync(input.tracePath, 'utf8')).not.toMatch(/prune|rmSync/u);
  });
});
