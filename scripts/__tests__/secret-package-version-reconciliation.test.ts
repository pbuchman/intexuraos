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

  it('runs repository-pin reconciliation before remote mutation and active-pin checks after activation', () => {
    const deploy = readFileSync(deployPath, 'utf8');
    const main = deploy.slice(deploy.indexOf('main() {'));

    expect(main).toContain('verify_repository_secret_package_version_pins');
    expect(main.indexOf('verify_repository_secret_package_version_pins')).toBeLessThan(
      main.indexOf('sync_repo')
    );
    const activationIndex = main.indexOf('activate_secret_projection');
    const postActivationVerificationIndex = main.lastIndexOf(
      'verify_active_secret_projection_version'
    );
    expect(activationIndex).toBeLessThan(postActivationVerificationIndex);
    expect(postActivationVerificationIndex).toBeLessThan(
      main.indexOf('run_secret_projection_canary')
    );
  });
});
