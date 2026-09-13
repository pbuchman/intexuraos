import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'deploy.yml');
const deployPath = resolve(repoRoot, 'scripts', 'hetzner', 'github-actions-deploy.sh');
const runbookPath = resolve(repoRoot, 'docs', 'operations', 'hetzner-prod-runbook.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function functionBody(script: string, name: string, nextName: string): string {
  return script.slice(script.indexOf(`${name}() {`), script.indexOf(`\n}\n\n${nextName}()`));
}

describe('admission-gated PROD deployment', () => {
  it('is manual-only and pins every third-party action to an immutable SHA', () => {
    const workflow = read(workflowPath);
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)].map(
      (match) => match[1]
    );

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*push:/mu);
    expect(actionReferences).toEqual([
      'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
      'google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed',
      'google-github-actions/setup-gcloud@e427ad8a34f8676edf47cf7d7925499adf3eb74f',
    ]);
    expect(actionReferences.every((reference) => /@[0-9a-f]{40}$/u.test(reference))).toBe(true);
  });

  it('passes one exact protected package version into the deployment', () => {
    const workflow = read(workflowPath);

    expect(workflow).toContain('SECRET_PACKAGE_VERSION: ${{ vars.PROD_SECRET_PACKAGE_VERSION }}');
    expect(workflow).not.toMatch(/SECRET_PACKAGE_VERSION[^\n]*latest/u);
    expect(workflow.indexOf('SECRET_PACKAGE_VERSION:')).toBeLessThan(
      workflow.indexOf('scripts/hetzner/github-actions-deploy.sh')
    );
  });

  it('validates inputs before network access and verifies the checkout and package pins', () => {
    const script = read(deployPath);
    const validation = functionBody(script, 'validate_inputs', 'resolve_release');
    const release = functionBody(script, 'resolve_release', 'prepare_release_tree');
    const main = script.slice(script.indexOf('main() {'));

    expect(validation).toContain('SECRET_PACKAGE_VERSION');
    expect(validation).toContain('^[1-9][0-9]*$');
    expect(release).toContain('git rev-parse HEAD');
    expect(release).toContain('git status --porcelain=v1 --untracked-files=all');
    expect(release).toContain('Checkout does not match GITHUB_SHA');
    expect(release).toContain('verify-secret-package-version-pins.mjs');
    expect(main.indexOf('validate_inputs')).toBeLessThan(main.indexOf('setup_ssh'));
    expect(main.indexOf('resolve_release')).toBeLessThan(main.indexOf('setup_ssh'));
  });

  it('validates the candidate before the destructive fix-forward boundary', () => {
    const script = read(deployPath);
    const deployment = functionBody(script, 'deploy_release', 'publish_deployment_metadata');
    const loaderIndex = deployment.indexOf('scripts/hetzner/load-secrets.sh --version');

    expect(deployment).toContain('Candidate admission is complete');
    expect(deployment).toContain('pm2 delete all');
    expect(deployment).toContain('systemctl stop alloy.service');
    expect(deployment).toContain('load-secrets.sh --validate-only --version');
    expect(deployment.indexOf('--validate-only')).toBeLessThan(
      deployment.indexOf('pm2 delete all')
    );
    expect(loaderIndex).toBeGreaterThan(deployment.indexOf('pm2 delete all'));
    expect(deployment).toContain('SECRET_PACKAGE_VERSION');
    expect(deployment).not.toMatch(/rollback|stage.only/iu);
    expect(script).not.toMatch(/compensate_secret_projection|reload_previous_runtime/u);
  });

  it('keeps silent SSH sessions alive and verifies the immutable remote release tree', () => {
    const script = read(deployPath);
    const ssh = functionBody(script, 'ssh_base', 'run_remote_at');
    const sync = functionBody(script, 'sync_release', 'deploy_release');

    expect(ssh).toContain('ServerAliveInterval=15');
    expect(ssh).toContain('ServerAliveCountMax=8');
    expect(ssh).toContain('StrictHostKeyChecking=yes');
    expect(sync).toContain('hash-release-tree.mjs');
    expect(sync).toContain('RELEASE_MANIFEST_HASH');
  });

  it('attests the exact SHA, workflow run, and numeric package version', () => {
    const script = read(deployPath);
    const publish = functionBody(script, 'publish_deployment_metadata', 'verify_remote_runtime');
    const publicVerification = functionBody(script, 'verify_public_runtime', 'main');

    expect(publish).toContain('secretPackageVersion');
    expect(publish).toContain('SECRET_PACKAGE_VERSION');
    expect(publicVerification).toContain('d.secretPackageVersion!==process.argv[3]');
    expect(publicVerification).toContain('SECRET_PACKAGE_VERSION');
  });

  it('never deletes code or web release artifacts during deployment', () => {
    const script = read(deployPath);
    const deployment = functionBody(script, 'deploy_release', 'publish_deployment_metadata');

    expect(deployment).not.toContain('delete_obsolete_releases');
    expect(script).not.toContain('prune-release-artifacts');
    expect(script).not.toContain('rmSync(path, { recursive: true })');
  });

  it('documents pre-shutdown rejection and current-package recovery boundaries', () => {
    const runbook = read(runbookPath).replace(/\s+/gu, ' ');

    expect(runbook).toMatch(/fix-forward/iu);
    expect(runbook).toContain('candidate rejection changes neither the live runtime');
    expect(runbook).toContain('Never restore an old package, key, projection');
    expect(runbook).toContain('code and web artifacts remain available');
    expect(runbook).toContain('deployment never prunes them');
    expect(runbook).not.toMatch(/\b(?:restore|select)\s+(?:the\s+)?(?:previous|old)\s+package\b/iu);
  });
});
