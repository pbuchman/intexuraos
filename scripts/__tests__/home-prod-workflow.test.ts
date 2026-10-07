import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
const ci = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

describe('Home PROD workflow admission', () => {
  it('uses only the exact self-hosted Home runner and fixed launcher', () => {
    expect(workflow).toContain("inputs.target == 'home-prod'");
    expect(workflow).toContain('runs-on: [self-hosted, Linux, X64, builder]');
    expect(workflow).toContain('[[ "$RUNNER_NAME" == \'home-dev\' ]]');
    expect(workflow).toContain('/usr/local/sbin/intexuraos-home-prod-deploy');
    expect(workflow).not.toContain('HETZNER_DEPLOY_SSH_PRIVATE_KEY');
    expect(workflow).not.toContain('github-actions-deploy.sh');
    expect(workflow).not.toContain('deploy_nginx');
  });

  it('requires exact development provenance, successful exact-SHA CI, and a numeric package version', () => {
    expect(workflow).toContain("$GITHUB_REF\" == 'refs/heads/development'");
    expect(workflow).toContain('git rev-parse origin/development');
    expect(workflow).toContain(
      'actions/workflows/ci.yml/runs?branch=development&event=push&status=success&head_sha=${GITHUB_SHA}'
    );
    expect(workflow).toContain('run.head_sha === expected');
    expect(workflow).toContain('PROD_SECRET_PACKAGE_VERSION" =~ ^[1-9][0-9]*$');
  });

  it('keeps edge render and real nginx/JWT checks in the exact-SHA CI workflow', () => {
    expect(ci).toContain('docker build -t intexuraos-home-prod-edge-test scripts/home-prod/tests');
    expect(ci).toContain(
      'scripts/home-prod/tests/edge-render.test.mjs scripts/home-prod/tests/edge-integration.test.mjs'
    );
  });
});
