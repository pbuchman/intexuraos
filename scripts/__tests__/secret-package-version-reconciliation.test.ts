import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const verifierPath = resolve(
  repositoryRoot,
  'scripts/hetzner/verify-secret-package-version-pins.mjs'
);
const deployPath = resolve(repositoryRoot, 'scripts/hetzner/github-actions-deploy.sh');
const temporaryDirectories: string[] = [];

function fixture(version = 17): { manifestPath: string; terraformPath: string } {
  const directory = mkdtempSync(resolve(tmpdir(), 'intexuraos-version-pins-'));
  temporaryDirectories.push(directory);
  const manifestPath = resolve(directory, 'secret-packages.json');
  const terraformPath = resolve(directory, 'prod.auto.tfvars.json');
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ schemaVersion: 1, packages: { prod: { stableVersion: version } } })}\n`,
    'utf8'
  );
  writeFileSync(
    terraformPath,
    `${JSON.stringify({ prod_secret_package_version: version })}\n`,
    'utf8'
  );
  return { manifestPath, terraformPath };
}

function verify(
  expectedVersion: string,
  manifestPath: string,
  terraformPath: string
): SpawnSyncReturns<string> {
  return spawnSync('node', [verifierPath, expectedVersion, manifestPath, terraformPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('PROD secret-package version reconciliation', () => {
  it('accepts one exact positive numeric version across deployment, manifest, and Terraform', () => {
    const { manifestPath, terraformPath } = fixture();

    const result = verify('17', manifestPath, terraformPath);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      environment: 'prod',
      status: 'MATCH',
      version: '17',
    });
    expect(result.stderr).toBe('');
  });

  it.each([
    ['latest', 17, 17],
    ['01', 1, 1],
    ['17', 18, 17],
    ['17', 17, 18],
  ])(
    'rejects an invalid or mismatched pin (deployment=%s manifest=%s terraform=%s)',
    (deploymentVersion, manifestVersion, terraformVersion) => {
      const { manifestPath, terraformPath } = fixture(manifestVersion);
      writeFileSync(
        terraformPath,
        `${JSON.stringify({ prod_secret_package_version: terraformVersion })}\n`,
        'utf8'
      );

      const result = verify(deploymentVersion, manifestPath, terraformPath);

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('SECRET_PACKAGE_VERSION_PINS_MISMATCH\n');
    }
  );

  it.each([
    ['malformed manifest', '{', '{"prod_secret_package_version":17}'],
    [
      'missing manifest pin',
      '{"schemaVersion":1,"packages":{"prod":{}}}',
      '{"prod_secret_package_version":17}',
    ],
    [
      'malformed Terraform inputs',
      '{"schemaVersion":1,"packages":{"prod":{"stableVersion":17}}}',
      '{',
    ],
    ['missing Terraform pin', '{"schemaVersion":1,"packages":{"prod":{"stableVersion":17}}}', '{}'],
  ])('fails closed for %s without echoing file content', (_name, manifest, terraform) => {
    const { manifestPath, terraformPath } = fixture();
    writeFileSync(manifestPath, manifest, 'utf8');
    writeFileSync(terraformPath, terraform, 'utf8');

    const result = verify('17', manifestPath, terraformPath);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('SECRET_PACKAGE_VERSION_PINS_MISMATCH\n');
    expect(result.stderr).not.toContain(manifest);
    expect(result.stderr).not.toContain(terraform);
  });

  it('reconciles repository pins before remote mutation and verifies runtime after exact projection', () => {
    const deploy = readFileSync(deployPath, 'utf8');
    const main = deploy.slice(deploy.indexOf('main() {'));
    const resolveRelease = deploy.slice(
      deploy.indexOf('resolve_release() {'),
      deploy.indexOf('prepare_release_tree() {')
    );
    const deployRelease = deploy.slice(
      deploy.indexOf('deploy_release() {'),
      deploy.indexOf('publish_deployment_metadata() {')
    );

    expect(resolveRelease).toContain('verify-secret-package-version-pins.mjs');
    expect(main.indexOf('resolve_release')).toBeLessThan(main.indexOf('sync_release'));
    const projectionIndex = deployRelease.indexOf('load-secrets.sh --version');
    const runtimeStartIndex = deployRelease.indexOf('reload-pm2.sh');
    const runtimeVerificationIndex = deployRelease.indexOf('verify_remote_runtime');
    expect(projectionIndex).toBeLessThan(runtimeStartIndex);
    expect(runtimeStartIndex).toBeLessThan(runtimeVerificationIndex);
  });
});
