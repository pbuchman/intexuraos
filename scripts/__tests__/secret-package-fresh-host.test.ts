import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const bootstrapPath = resolve(repoRoot, 'terraform', 'hetzner-prod', 'bootstrap.tf');
const deployPath = resolve(repoRoot, 'scripts', 'hetzner', 'github-actions-deploy.sh');
const loaderPath = resolve(repoRoot, 'scripts', 'hetzner', 'load-secrets.sh');
const provisionPath = resolve(repoRoot, 'scripts', 'hetzner', 'provision.sh');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function functionBody(script: string, name: string, nextName: string): string {
  return script.slice(script.indexOf(`${name}() {`), script.indexOf(`\n}\n\n${nextName}()`));
}

describe('fresh-host PROD secret package', () => {
  it('installs locked dependencies before provisioning loads the exact package version', () => {
    const provision = read(provisionPath);
    const dependencyInstaller = functionBody(
      provision,
      'install_workspace_dependencies',
      'configure_firewall'
    );
    const main = provision.slice(provision.indexOf('main() {'));

    expect(dependencyInstaller).toContain('pnpm install --frozen-lockfile');
    expect(main.indexOf('install_workspace_dependencies')).toBeGreaterThan(
      main.indexOf('install_node_22')
    );
    expect(main.indexOf('install_workspace_dependencies')).toBeLessThan(
      main.indexOf('load-secrets.sh')
    );
    expect(main).toContain('--version "${SECRET_PACKAGE_VERSION}"');
  });

  it('pins bootstrap provisioning to one clean commit and numeric package version', () => {
    const bootstrap = read(bootstrapPath);
    const provisionLine =
      bootstrap
        .split('\n')
        .find(
          (line) => line.includes('scripts/hetzner/provision.sh') && line.includes('--version')
        ) ?? '';

    expect(bootstrap).toContain(
      `commit_sha="$(git -C '\${local.repo_root}' rev-parse --verify HEAD)"`
    );
    expect(bootstrap).toContain('status --porcelain=v1 --untracked-files=all');
    expect(provisionLine).toContain('INTEXURAOS_COMMIT_SHA=$commit_sha_quoted');
    expect(provisionLine).toContain('--version ${var.prod_secret_package_version}');
  });

  it('installs the immutable release before the ordinary deploy loads secrets', () => {
    const deploy = read(deployPath);
    const deployment = functionBody(deploy, 'deploy_release', 'publish_deployment_metadata');

    expect(deployment.indexOf('CI=true pnpm install --frozen-lockfile')).toBeLessThan(
      deployment.indexOf('scripts/hetzner/load-secrets.sh --version')
    );
    expect(deployment).toContain('REMOTE_RELEASE_DIR');
  });

  it('validates the exact numeric version before accessing an offline payload', () => {
    const loader = read(loaderPath);
    const preconditions = functionBody(loader, 'require_preconditions', 'acquire_lock');

    expect(preconditions).toContain('SECRET_PACKAGE_VERSION');
    expect(preconditions).toContain('^[1-9][0-9]*$');
    expect(preconditions.indexOf('SECRET_PACKAGE_VERSION')).toBeLessThan(
      preconditions.indexOf('Offline payload is unreadable')
    );
  });

  it.each(['', 'latest', '0', '01', '-1', '1.0'])(
    'fails closed for non-canonical package version %s before payload access',
    (version) => {
      const result = spawnSync(
        'bash',
        [
          loaderPath,
          '--version',
          version,
          '--project-id',
          'intexuraos-dev-pbuchman',
          '--payload-file',
          resolve(repoRoot, 'missing-secret-package-payload.json'),
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            INTEXURAOS_ENVIRONMENT: 'prod',
            SKIP_OWNERSHIP: '1',
            SKIP_RUNTIME_CREDENTIAL_SMOKE: '1',
          },
        }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'SECRET_PACKAGE_VERSION must be an exact positive numeric version'
      );
      expect(result.stderr).not.toContain('Offline payload is unreadable');
    }
  );

  it('contains no rollback or previous-release loader mode', () => {
    const loader = read(loaderPath);

    expect(loader).toContain('This loader has no rollback, previous-release, or legacy mode');
    expect(loader).not.toMatch(/--rollback|--activate|--stage-only/u);
  });
});
