import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('final secret-package integrations', () => {
  it('loads DEV and PROD only from exact package versions', () => {
    for (const path of ['scripts/sync-secrets.sh', 'scripts/hetzner/load-secrets.sh'] as const) {
      const script = read(path);

      expect(script, path).toContain('scripts/secret-package.mjs');
      expect(script, path).toMatch(/SECRET_PACKAGE_VERSION/u);
      expect(script, path).not.toContain('versions/latest');
      expect(script, path).not.toContain('secrets versions access latest');
      expect(script, path).not.toContain('secretmanager.googleapis.com/v1/projects');
    }
  });

  it('uses a dedicated DEV package renderer without exporting its credential to runtime', () => {
    const sync = read('scripts/sync-secrets.sh');

    expect(sync).toContain('SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS');
    expect(sync).toContain('CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE');
    expect(sync).toContain('ixos-home-secret-renderer-dev@');
    expect(sync).not.toMatch(/export GOOGLE_APPLICATION_CREDENTIALS=/u);
  });

  it('keeps direct Secret Manager reads out of runtime consumers', () => {
    for (const path of [
      'scripts/hetzner/install-nginx-and-cert.sh',
      'scripts/observability/load-grafana-cloud-env.sh',
      'workers/orchestrator/src/bootstrap/secret-manager.ts',
      'docker/code-worker/entrypoint.sh',
    ] as const) {
      const source = read(path);

      expect(source, path).not.toContain('gcloud secrets');
      expect(source, path).not.toContain('versions access');
      expect(source, path).not.toContain('/repo/scripts/sync-secrets.sh');
    }
  });

  it('keeps the Firebase browser key in the package and out of tracked public config', () => {
    const commonConfig = JSON.parse(read('config/environments/common.json')) as Record<
      string,
      unknown
    >;
    const policy = JSON.parse(read('config/environments/policy.json')) as {
      scopes: Record<string, string[]>;
    };
    const manifest = JSON.parse(read('config/environments/secret-packages.json')) as {
      packages: Record<string, { envNames: string[] }>;
    };

    expect(commonConfig).not.toHaveProperty('INTEXURAOS_FIREBASE_API_KEY');
    expect(Object.values(policy.scopes).flat()).not.toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(manifest.packages.dev?.envNames).toContain('INTEXURAOS_FIREBASE_API_KEY');
    expect(manifest.packages.prod?.envNames).toContain('INTEXURAOS_FIREBASE_API_KEY');
  });

  it('defines exact final package membership and no direct-provider keys', () => {
    const manifest = JSON.parse(read('config/environments/secret-packages.json')) as {
      nativeSecretNames: string[];
      packages: Record<string, { envNames: string[]; files: string[] }>;
    };
    const removed = [
      'INTEXURAOS_DASHSCOPE_APP_API_KEY',
      'INTEXURAOS_GEMINI_APP_API_KEY',
      'INTEXURAOS_KIMI_APP_API_KEY',
      'INTEXURAOS_MIMO_APP_API_KEY',
      'INTEXURAOS_MINIMAX_APP_API_KEY',
      'INTEXURAOS_OPENAI_APP_API_KEY',
      'INTEXURAOS_WEBHOOK_VERIFY_SECRET',
    ];
    const allMembers = Object.values(manifest.packages).flatMap((entry) => [
      ...entry.envNames,
      ...entry.files,
    ]);

    expect(manifest.nativeSecretNames).toEqual([
      'INTEXURAOS_INTERNAL_AUTH_TOKEN',
      'INTEXURAOS_SPEECHMATICS_APP_API_KEY',
    ]);
    expect(manifest.packages.dev?.envNames).toHaveLength(22);
    expect(manifest.packages.prod?.envNames).toHaveLength(21);
    expect(manifest.packages.prod?.envNames).toContain(
      'INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_ID'
    );
    expect(manifest.packages.prod?.envNames).toContain(
      'INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_SECRET'
    );
    expect(manifest.packages.dev?.envNames).not.toContain(
      'INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_ID'
    );
    expect(manifest.packages.dev?.envNames).not.toContain(
      'INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_SECRET'
    );
    expect(manifest.packages.dev?.files).toEqual(['githubAppPrivateKeyPemBase64']);
    expect(manifest.packages.prod?.files).toEqual([
      'cloudflareDnsApiTokenBase64',
      'runtimeGcpServiceAccountJsonBase64',
      'tlsPrivateKeyPemBase64',
    ]);
    for (const name of removed) {
      expect(allMembers, name).not.toContain(name);
    }
  });

  it('makes production deployment manual-only and pins its package version', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const deploy = read('scripts/hetzner/github-actions-deploy.sh');
    const verifier = read('scripts/hetzner/verify-deployment-document.mjs');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/push:\s*\n\s*branches:\s*\[development\]/u);
    expect(workflow).toContain('PROD_SECRET_PACKAGE_VERSION');
    expect(deploy).toContain('SECRET_PACKAGE_VERSION');
    expect(deploy).not.toContain('--rollback');
    expect(deploy).not.toContain('previous immutable release');
    expect(verifier).toContain('secretPackageVersion');
  });

  it('uses a one-shot PROD projection with no history or rollback surface', () => {
    const loader = read('scripts/hetzner/load-secrets.sh');

    expect(loader).toContain('Services must be');
    expect(loader).toContain('stopped before it runs');
    expect(loader).toContain('rm -rf -- "${SECRET_PROJECTION_ROOT}"');
    expect(loader).not.toContain('--rollback');
    expect(loader).not.toContain('--activate');
    expect(loader).not.toContain('current-release');
    expect(loader).not.toContain('versions/latest');
  });

  it('keeps current package operations fix-forward and archives the destructive cutover', () => {
    const operations = read('docs/operations/secret-packages.md');
    const plan = read('docs/operations/secret-exposure-final-cutover-plan.md');

    expect(operations).toContain('fix forward');
    expect(operations).toContain('four final application containers');
    expect(operations).toContain('old credentials reject requests or are absent');
    expect(operations).not.toContain('Phase A');
    expect(operations).not.toContain('Phase B');
    expect(operations).not.toContain('seven-day');
    expect(operations).not.toContain('dual-read');
    expect(plan).toContain('# Secret Exposure Final Cutover Plan (Historical Archive)');
    expect(plan).toContain('Status: historical archive; do not execute.');
    expect(plan).toContain('## Historical Autonomous Agent Goal Template — Do Not Create');
    expect(plan).toContain('[current DEV hibernation runbook](./dev-hibernation.md)');
    expect(plan).toContain('[Secret Packages Operations](./secret-packages.md)');
    expect(plan).toContain('superseded and must not be used for\na current change');
    expect(plan).not.toContain('\n## Autonomous Agent Goal\n');
    expect(plan).toMatch(/same reviewed SHA deployed to\s*>?\s*Home Dev and production/u);
  });

  it('keeps package evidence metadata-only', () => {
    const operations = read('docs/operations/secret-packages.md');

    expect(operations).toContain('Never\nrecord payloads');
    expect(operations).toContain('state lineage');
    expect(operations).toContain('workflow run');
    expect(operations).toContain('PASS/FAIL counts');
  });
});
