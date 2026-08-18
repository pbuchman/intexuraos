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

describe('fresh-host PROD secret-package bootstrap', () => {
  it('installs locked workspace dependencies before provisioning invokes the package loader', () => {
    const provision = read(provisionPath);
    const dependencyInstaller = functionBody(
      provision,
      'install_workspace_dependencies',
      'configure_firewall'
    );
    const main = provision.slice(provision.indexOf('main() {'));

    expect(dependencyInstaller).toContain('pnpm install --frozen-lockfile');
    expect(dependencyInstaller).toContain('DEPLOY_USER');
    expect(main.indexOf('install_workspace_dependencies')).toBeGreaterThan(
      main.indexOf('install_node_22')
    );
    expect(main.indexOf('install_workspace_dependencies')).toBeLessThan(
      main.indexOf('load-secrets.sh')
    );
  });

  it('pins the bootstrap package projection to the exact candidate commit', () => {
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

  it('installs dependencies before the ordinary deploy invokes the package loader', () => {
    const deploy = read(deployPath);
    const runtimeDependencies = functionBody(
      deploy,
      'prepare_runtime_dependencies',
      'deploy_runtime'
    );

    expect(runtimeDependencies.indexOf('CI=true pnpm install --frozen-lockfile')).toBeLessThan(
      runtimeDependencies.indexOf('scripts/hetzner/load-secrets.sh')
    );
    expect(runtimeDependencies).toContain('INTEXURAOS_COMMIT_SHA=${commit_sha_quoted}');
  });
});

describe('PROD projection commit identity', () => {
  it('makes the exact candidate SHA mandatory in the provisioner and loader', () => {
    const provision = read(provisionPath);
    const loader = read(loaderPath);
    const provisionMain = provision.slice(provision.indexOf('main() {'));
    const loaderPreconditions = functionBody(loader, 'require_preconditions', 'render_package');
    const publishProjection = functionBody(loader, 'publish_projection', 'main');

    expect(provision).toContain('INTEXURAOS_COMMIT_SHA');
    expect(provision).toContain('^[0-9a-f]{40}$');
    expect(provisionMain).toContain(
      'INTEXURAOS_COMMIT_SHA="${INTEXURAOS_COMMIT_SHA}" "${SCRIPT_DIR}/load-secrets.sh"'
    );
    expect(loaderPreconditions).toContain('INTEXURAOS_COMMIT_SHA');
    expect(loaderPreconditions).toContain('^[0-9a-f]{40}$');
    expect(publishProjection).not.toContain('git -C');
    expect(publishProjection).not.toContain("commit='manual'");
  });

  it.each(['', 'manual', 'A'.repeat(40), 'a'.repeat(39), `${'a'.repeat(40)}-dirty`])(
    'rejects invalid candidate SHA %s before privileged provisioning work',
    (commitSha) => {
      const result = spawnSync('bash', [provisionPath, '--version', '7', '--skip-certbot'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          INTEXURAOS_COMMIT_SHA: commitSha,
          INTEXURAOS_ENVIRONMENT: 'prod',
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'INTEXURAOS_COMMIT_SHA must be a 40-character lowercase hexadecimal SHA'
      );
      expect(result.stdout).not.toContain('Installing');
    }
  );

  it.each(['', 'manual', 'A'.repeat(40), 'a'.repeat(39), `${'a'.repeat(40)}-dirty`])(
    'fails closed before package access for invalid candidate SHA %s',
    (commitSha) => {
      const result = spawnSync(
        'bash',
        [
          loaderPath,
          '--version',
          '7',
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
            INTEXURAOS_COMMIT_SHA: commitSha,
            INTEXURAOS_ENVIRONMENT: 'prod',
            SKIP_OWNERSHIP: '1',
            SKIP_RUNTIME_CREDENTIAL_SMOKE: '1',
          },
        }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'INTEXURAOS_COMMIT_SHA must be a 40-character lowercase hexadecimal SHA'
      );
      expect(result.stderr).not.toContain('Offline payload file is unreadable');
    }
  );
});
