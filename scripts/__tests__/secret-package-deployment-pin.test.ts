import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const workflow = readFileSync(resolve(repoRoot, '.github/workflows/deploy.yml'), 'utf8');
const deploy = readFileSync(resolve(repoRoot, 'scripts/home-prod/deploy-release.sh'), 'utf8');

describe('admission-gated Home PROD deployment', () => {
  it('is manual-only and pins every third-party action to an immutable SHA', () => {
    const actions = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)].map(
      (match) => match[1]
    );
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*push:/mu);
    expect(actions.every((reference) => /@[0-9a-f]{40}$/u.test(reference))).toBe(true);
  });

  it('reconciles the numeric package version before the bounded privileged launcher', () => {
    const verification =
      'node scripts/home-prod/verify-secret-package-version-pins.mjs "$PROD_SECRET_PACKAGE_VERSION" config/environments/secret-packages.json';
    expect(workflow).toContain(
      'PROD_SECRET_PACKAGE_VERSION: ${{ vars.PROD_SECRET_PACKAGE_VERSION }}'
    );
    expect(workflow).not.toMatch(/PROD_SECRET_PACKAGE_VERSION[^\n]*latest/u);
    expect(workflow).toContain(verification);
    expect(workflow.indexOf(verification)).toBeLessThan(
      workflow.indexOf('/usr/local/sbin/intexuraos-home-prod-deploy')
    );
  });

  it('admits and builds the candidate before stopping or replacing the active runtime', () => {
    const main = deploy.slice(deploy.indexOf('main() {'));
    expect(main.indexOf('validate_secret_candidate')).toBeLessThan(
      main.indexOf('publish_staged_release')
    );
    expect(main.indexOf('validate_runtime_candidate')).toBeLessThan(
      main.indexOf('publish_staged_release')
    );
    expect(main.indexOf('check_candidate_ports')).toBeLessThan(
      main.indexOf('publish_staged_release')
    );
    expect(deploy).toContain('bash scripts/home-prod/load-secrets.sh');
    expect(deploy).toContain('bash scripts/home-prod/reload-pm2.sh');
    expect(deploy).not.toMatch(/\bssh\b|scripts\/hetzner/u);
  });
});
