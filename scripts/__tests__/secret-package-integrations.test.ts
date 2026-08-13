import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('secret package runtime integrations', () => {
  it('loads local and production configuration from exact package versions', () => {
    for (const path of ['scripts/sync-secrets.sh', 'scripts/hetzner/load-secrets.sh'] as const) {
      const script = read(path);

      expect(script, path).toContain('scripts/secret-package.mjs');
      expect(script, path).toMatch(/SECRET_PACKAGE_VERSION/u);
      expect(script, path).not.toContain('versions/latest');
      expect(script, path).not.toContain('secrets versions access latest');
      expect(script, path).not.toContain('secretmanager.googleapis.com/v1/projects');
    }
  });

  it('supports a dedicated DEV package-renderer bootstrap credential', () => {
    const sync = read('scripts/sync-secrets.sh');

    expect(sync).toContain('SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS');
    expect(sync).toContain('CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE');
    expect(sync).toContain('ixos-home-secret-renderer-dev@');
    expect(sync).not.toMatch(/export GOOGLE_APPLICATION_CREDENTIALS=/u);
  });

  it('makes nginx, certbot, and Grafana consume rendered files without direct secret reads', () => {
    for (const path of [
      'scripts/hetzner/install-nginx-and-cert.sh',
      'scripts/observability/load-grafana-cloud-env.sh',
    ] as const) {
      const script = read(path);

      expect(script, path).not.toContain('gcloud secrets');
      expect(script, path).not.toContain('versions/latest');
    }
  });

  it('makes the orchestrator read its rendered GitHub App PEM without invoking Secret Manager', () => {
    const bootstrap = read('workers/orchestrator/src/bootstrap/secret-manager.ts');

    expect(bootstrap).not.toContain('gcloud secrets');
    expect(bootstrap).not.toContain('versions access');
    expect(bootstrap).toContain('GITHUB_APP_PRIVATE_KEY_PATH');
  });

  it('does not synchronize all secrets inside code-worker containers', () => {
    const entrypoint = read('docker/code-worker/entrypoint.sh');

    expect(entrypoint).not.toContain('/repo/scripts/sync-secrets.sh');
    expect(entrypoint).not.toContain('Syncing secrets from Secret Manager');
  });

  it('keeps the Firebase browser key out of tracked runtime configuration', () => {
    const commonConfig = JSON.parse(read('config/environments/common.json')) as Record<
      string,
      unknown
    >;
    const policy = JSON.parse(read('config/environments/policy.json')) as {
      scopes: Record<string, string[]>;
      sensitiveConfigNameAllowlist: string[];
    };
    const manifest = JSON.parse(read('config/environments/secret-packages.json')) as {
      packages: Record<string, { envNames: string[] }>;
    };

    expect(commonConfig).not.toHaveProperty('INTEXURAOS_FIREBASE_API_KEY');
    expect(Object.values(policy.scopes).flat()).not.toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(policy.sensitiveConfigNameAllowlist).not.toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(manifest.packages.dev?.envNames).toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(manifest.packages.prod?.envNames).toContain('INTEXURAOS_FIREBASE_API_KEY');
  });

  it('pins the deployed package version and records it in the deployment attestation', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const deploy = read('scripts/hetzner/github-actions-deploy.sh');
    const verifier = read('scripts/hetzner/verify-deployment-document.mjs');

    expect(workflow).toMatch(/SECRET_PACKAGE_VERSION/u);
    expect(deploy).toMatch(/SECRET_PACKAGE_VERSION/u);
    expect(verifier).toContain('secretPackageVersion');
    expect(workflow).not.toMatch(/SECRET_PACKAGE_VERSION[^\n]*latest/u);
  });

  it('documents the exact PROD pin source and the two independent current pointers', () => {
    const operations = read('docs/operations/secret-packages.md');
    const productionRunbook = read('docs/operations/hetzner-prod-runbook.md');

    expect(productionRunbook).toContain('`PROD_SECRET_PACKAGE_VERSION`');
    expect(productionRunbook).toContain('repository variable');
    expect(productionRunbook).toContain('There is no manual version input or GitHub environment');
    expect(productionRunbook).not.toContain(
      '| `SECRET_PACKAGE_VERSION` | protected environment variable or manual input |'
    );
    expect(operations).toContain('generic package `current`');
    expect(operations).toContain('runtime projection `current`');
    expect(productionRunbook).toContain('generic package `current`');
    expect(productionRunbook).toContain('runtime projection `current`');
  });

  it('keeps the production canary and endpoint declaration aligned with the implementation', () => {
    const goal = read('docs/plans/2026-08-13-secret-packages-production-goal.md');
    const phaseSix = goal.slice(goal.indexOf('### Phase 6'), goal.indexOf('### Phase 7'));
    const endpointChanges = goal.slice(
      goal.indexOf('## Endpoint Changes'),
      goal.indexOf('## Rollback boundary')
    );

    expect(phaseSix).not.toContain('GitHub App');
    expect(endpointChanges).toContain('Modified: `GET /deployment.json`');
    expect(endpointChanges).toContain('`secretPackageVersion`');
    expect(endpointChanges).not.toContain('Modified: none');
  });

  it('defines measurable reconciliation, rollback, audit, rotation, break-glass, and DR gates', () => {
    const operations = read('docs/operations/secret-packages.md').replace(/\s+/gu, ' ');
    const goal = read('docs/plans/2026-08-13-secret-packages-production-goal.md').replace(
      /\s+/gu,
      ' '
    );

    for (const required of [
      'Version Reconciliation Gate',
      'three five-minute samples',
      '34-name sorted legacy set',
      'exhaustive pagination',
      '24 continuous hours',
      '24-hour pre-disable observation',
      'seven-day disabled soak',
      'maximum TTL is 60 minutes',
      'two-person approval',
      'recovery time objective is four hours',
    ]) {
      expect(operations, required).toContain(required);
    }
    expect(goal).toContain('Version reconciliation');
    expect(goal).toContain('34-name legacy audit set');
    expect(goal).toContain('old Firebase key request count is `0` for 24 continuous hours');
    expect(goal).toContain('seven-day disabled soak');
    expect(goal).toContain('60-minute conditional binding');
    expect(goal).toContain('four-hour recovery time objective');
  });

  it('records the fresh no-change plan and live zero-binding home identity evidence', () => {
    const goal = read('docs/plans/2026-08-13-secret-packages-production-goal.md');

    expect(goal).toContain('2026-08-13 15:09 Europe/Warsaw');
    expect(goal).toContain('fresh retained-GCP plan exited `0` with `No changes`');
    expect(goal).toContain('exactly `0` Secret Manager bindings for both home identities');
    expect(goal).toContain('`ixos-home-runtime-dev`');
    expect(goal).toContain('`ixos-home-orchestrator-dev`');
  });

  it('indexes internal-auth rotation as a maintenance cutover, not dual-token rotation', () => {
    const siteIndex = JSON.parse(read('docs/site-index.json')) as {
      documentation: { description: string; path: string }[];
    };
    const entry = siteIndex.documentation.find(
      ({ path }) => path === 'runbooks/internal-auth-rotation.md'
    );

    expect(entry?.description).toContain('maintenance cutover');
    expect(entry?.description).not.toContain('dual-token');
  });

  it('runs the package verifier and credential guards in local and hosted CI', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const localCi = read('scripts/ci.mjs');
    const hostedCi = read('.github/workflows/ci.yml');

    expect(packageJson.scripts['verify:secret-packages']).toBe(
      'node scripts/verify-secret-packages.mjs'
    );
    expect(packageJson.scripts['verify:credential-files']).toBe(
      'node scripts/verify-credential-files.mjs'
    );
    expect(localCi).toContain("script: 'verify-secret-packages.mjs'");
    expect(localCi).toContain("script: 'verify-credential-files.mjs'");
    expect(hostedCi).toContain('node scripts/verify-secret-packages.mjs');
    expect(hostedCi).toContain('node scripts/verify-credential-files.mjs');
  });
});
