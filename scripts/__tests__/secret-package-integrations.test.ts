import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

  it.each(['scripts/README.md', 'docs/operations/secret-packages.md'])(
    'documents durable publish recovery in %s',
    (relativePath) => {
      const document = read(relativePath);

      expect(document).toContain('--receipt-file <private-receipt>');
      expect(document).toContain('publish-resume');
      expect(document).toContain('pending-verification');
      expect(document).toContain('state `publishing`');
      expect(document).toContain('publish-unlock');
      expect(document).toContain('publish-resume');
      expect(document).toContain('publish-reconcile');
      expect(document).toContain('--version <exact-recovery-version>');
      expect(document).toContain('prePublishMaxVersion');
      expect(document).toContain('operationId');
      expect(document).toContain('startedAt');
      expect(document).toContain('exactly one');
      expect(document).toContain('canonical private journal parent');
      expect(document).toContain('no supported `publish-abort`');
      expect(document).toContain('must not run `publish` again');
    }
  );

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

  it('documents an ordered three-pin recovery after production compensation', () => {
    const operations = read('docs/operations/secret-packages.md').replace(/\s+/gu, ' ');

    expect(operations).toContain('Ordered compensated-deployment pin recovery');
    expect(operations).toContain('freeze automatic production deployment dispatches');
    expect(operations).toContain('set `PROD_SECRET_PACKAGE_VERSION` to the recorded prior version');
    expect(operations).toContain('Revert both tracked pins in one reviewed commit');
    expect(operations).toContain('Resume deployment dispatches only after');
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
    expect(goal).toContain('old-credential-UID request count `0`');
    expect(goal).toContain('seven-day disabled window');
    expect(goal).toContain('60-minute conditional binding');
    expect(goal).toContain('four-hour recovery time objective');
  });

  it('documents a reversible two-phase legacy cleanup without Terraform-managed payloads', () => {
    const operations = read('docs/operations/secret-packages.md').replace(/\s+/gu, ' ');
    const terraformReadme = read('terraform/README.md').replace(/\s+/gu, ' ');
    const infrastructureRules = read('.claude/reference/infrastructure.md').replace(/\s+/gu, ' ');

    for (const required of [
      'Accelerated reversible Phase A',
      '`legacy_secret_readers_enabled=false`',
      '`legacy_secret_containers_enabled=true`',
      '`D_legacy`',
      'seven complete, non-overlapping 24-hour intervals',
      'Phase B',
      '`legacy_secret_containers_enabled=false`',
    ]) {
      expect(operations, required).toContain(required);
    }
    expect(operations).toContain('Phase A and Phase B must never share a saved plan');
    expect(terraformReadme).toContain('Phase A removes readers while retaining containers');
    expect(terraformReadme).toContain('Phase B removes containers only after the reversible soak');
    expect(infrastructureRules).toContain('Disabling an existing Secret Manager version');
    expect(infrastructureRules).toContain('controlled data-plane exception');
    expect(infrastructureRules).toContain('must never place `secret_data` in Terraform state');
  });

  it('documents executable and bounded rollout soak queries', () => {
    const operations = read('docs/operations/secret-packages.md');

    expect(operations).toContain('serviceruntime.googleapis.com/api/request_count');
    expect(operations).toContain('resource.labels.credential_id="apikey:');
    expect(operations).toContain('pageSize=100000');
    expect(operations).toContain('nextPageToken');
    expect(operations).toContain('30 minutes');
    expect(operations).toContain('iam.googleapis.com/service_account/key/authn_events_count');
    expect(operations).toContain('metric.labels.key_id');
    expect(operations).toContain('three hours');
    expect(operations).toContain('disabled keys');
    expect(operations).toContain(
      'google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion'
    );
    expect(operations).toContain('timestamp>="${audit_t0}"');
    expect(operations).toContain('timestamp<="${audit_t1}"');
    expect(operations).toContain('/versions/[^/]+$');
    expect(operations).toContain('Do not pass `--limit`');
    expect(operations).not.toMatch(/--header "Authorization: Bearer \$\{/u);
    expect(operations).not.toContain('gcloud secrets versions access "${control_version}"');
  });

  it('documents a durable dual-package legacy-read observation transaction', () => {
    const operations = read('docs/operations/secret-packages.md');
    const legacyGate = operations.slice(
      operations.indexOf('### Executable 34-name legacy-read gate'),
      operations.indexOf('## Rollback')
    );
    const normalizedLegacyGate = legacyGate.replace(/\s+/gu, ' ');
    const t1Stage = legacyGate.slice(
      legacyGate.indexOf('# T1 stage'),
      legacyGate.indexOf('# Query stage')
    );
    const queryStage = legacyGate.slice(
      legacyGate.indexOf('# Query stage'),
      legacyGate.indexOf('Classify locally')
    );
    const bashBlocks = [...legacyGate.matchAll(/```bash\n([\s\S]*?)\n```/gu)].map(
      (match) => match[1]
    );
    const t0Stage = bashBlocks[0] ?? '';
    const classificationStage = bashBlocks[3] ?? '';

    expect(bashBlocks).toHaveLength(4);
    for (const stage of [t0Stage, t1Stage, queryStage, classificationStage]) {
      expect(stage.split('\n')).toContain('unset CLOUDSDK_AUTH_ACCESS_TOKEN');
      expect(stage).toContain('unset CLOUDSDK_AUTH_ACCESS_TOKEN_FILE');
    }
    expect(legacyGate.match(/^unset CLOUDSDK_AUTH_ACCESS_TOKEN$/gmu)).toHaveLength(4);
    expect(legacyGate.match(/^unset CLOUDSDK_AUTH_ACCESS_TOKEN_FILE$/gmu)).toHaveLength(4);
    expect(t0Stage.match(/CLOUDSDK_AUTH_ACCESS_TOKEN=''/gu)).toHaveLength(9);
    expect(t1Stage.match(/CLOUDSDK_AUTH_ACCESS_TOKEN=''/gu)).toHaveLength(9);
    expect(queryStage.match(/CLOUDSDK_AUTH_ACCESS_TOKEN=''/gu)).toHaveLength(9);
    expect(t0Stage.match(/CLOUDSDK_AUTH_ACCESS_TOKEN_FILE=''/gu)).toHaveLength(9);
    expect(t1Stage.match(/CLOUDSDK_AUTH_ACCESS_TOKEN_FILE=''/gu)).toHaveLength(9);
    expect(queryStage.match(/CLOUDSDK_AUTH_ACCESS_TOKEN_FILE=''/gu)).toHaveLength(9);
    expect(t0Stage.match(/CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=''/gu)).toHaveLength(4);
    expect(t1Stage.match(/CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=''/gu)).toHaveLength(4);
    expect(queryStage.match(/CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=''/gu)).toHaveLength(5);
    expect(
      t0Stage.match(/CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="\$\{operator_credential_file\}"/gu)
    ).toHaveLength(5);
    expect(
      t1Stage.match(/CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="\$\{operator_credential_file\}"/gu)
    ).toHaveLength(5);
    expect(
      queryStage.match(/CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="\$\{operator_credential_file\}"/gu)
    ).toHaveLength(4);
    expect(legacyGate).not.toMatch(/-u CLOUDSDK_AUTH_ACCESS_TOKEN(?:_FILE)?/u);
    expect(legacyGate).not.toContain('-u CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE');
    expect(classificationStage).not.toContain('gcloud');
    expect(t0Stage).toContain('set -euo pipefail');
    expect(t0Stage).toContain('legacy_gate_dir="$(mktemp -d');
    expect(t0Stage).toContain('run_package_control t0 dev');
    expect(t0Stage).toContain('git -C "${repo_root}" diff --quiet');
    expect(t0Stage).toContain('git -C "${repo_root}" show');
    expect(t0Stage).toContain('scripts/lib/dev-secret-sync-lock.mjs');
    expect(t0Stage.indexOf('set -euo pipefail')).toBeLessThan(
      t0Stage.indexOf('run_package_control t0 dev')
    );

    expect(legacyGate).toContain(
      'legacy_gate_parent="${HOME}/.local/state/intexuraos/secret-migration"'
    );
    expect(legacyGate).toContain('mktemp -d "${legacy_gate_parent}/legacy-read-gate.XXXXXX"');
    expect(legacyGate).not.toContain('mktemp -d "${TMPDIR:-/tmp}/legacy-read-gate.XXXXXX"');
    expect(legacyGate).not.toContain('trap \'rm -rf -- "${legacy_gate_dir}"\' EXIT');
    expect(legacyGate).toContain("printf 'export LEGACY_GATE_DIR=%q\\n'");
    expect(legacyGate).toContain("reviewed_sha='c8c24cddfe652995f0d5c69dce0f912b3a2315b8'");
    expect(legacyGate).toContain(
      "expected_inventory_sha256='6324dca830a96cff486aeff3a1cf3cad9bf2aa42192b1957de6362015e1e5413'"
    );
    expect(legacyGate).toContain("org_id='398419898183'");
    expect(legacyGate).toContain("org_policy_reader_account='kontakt@pbuchman.com'");
    expect(normalizedLegacyGate).toContain(
      'T0 remains blocked until the explicitly selected organization reader can attest the parent policy, organization audit log, and project private Data Access log without reauthentication'
    );

    expect(legacyGate).toContain(
      "dev_control_principal='ixos-secret-publisher-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'"
    );
    expect(legacyGate).toContain(
      "prod_control_principal='ixos-secret-publisher-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com'"
    );
    expect(legacyGate).toContain("dev_control_secret='INTEXURAOS_SECRET_PACKAGE_DEV'");
    expect(legacyGate).toContain("dev_control_version='2'");
    expect(legacyGate).toContain("prod_control_secret='INTEXURAOS_SECRET_PACKAGE_PROD'");
    expect(legacyGate).toContain("prod_control_version='2'");
    expect(legacyGate).toContain('run_package_control t0 dev');
    expect(legacyGate).toContain('run_package_control t0 prod');
    expect(legacyGate).toContain('run_package_control t1 dev');
    expect(legacyGate).toContain('run_package_control t1 prod');
    expect(legacyGate).toContain(
      'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT="${control_principal}"'
    );

    expect(normalizedLegacyGate).toContain('cloudflared.service is active');
    expect(normalizedLegacyGate).toContain('Scheduler is `ENABLED`');
    expect(normalizedLegacyGate).toContain(
      'zero code-worker containers on any image with forbidden GCP credential environment, credential file, direct Secret Manager, or secret-sync wiring'
    );
    expect(normalizedLegacyGate).not.toContain('prior-image worker count is zero');
    expect(normalizedLegacyGate).toContain('post-resume package-only canary');
    expect(normalizedLegacyGate).toContain('Only then may the T0 controls run');
    expect(normalizedLegacyGate).toContain(
      'requires a terminal task callback and secret-isolation PASS; it does not require model/provider success'
    );
    expect(normalizedLegacyGate).toContain(
      'Provider usage, quota, or entitlement outcomes are outside this secret migration'
    );
    expect(normalizedLegacyGate).toContain(
      'callback is terminal, bootstrap/projection checks pass, and authentication/Secret Manager error counts are zero'
    );

    expect(legacyGate).toContain('max_page_count=10000');
    expect(legacyGate).toContain('repeated page token');
    expect(legacyGate).toContain('control-t0-dev.json');
    expect(legacyGate).toContain('control-t0-prod.json');
    expect(legacyGate).toContain('control-t1-dev.json');
    expect(legacyGate).toContain('control-t1-prod.json');
    expect(legacyGate).toContain('audit-config-t0.json');
    expect(legacyGate).toContain('audit-config-t1.json');
    expect(legacyGate).toContain('audit-config-query.json');
    expect(legacyGate).toContain('logging-route-t0.json');
    expect(legacyGate).toContain('logging-route-t1.json');
    expect(legacyGate).toContain('logging-route-query.json');
    expect(legacyGate).toContain('notBeforeT1: new Date(start + 72 * 60 * 60 * 1000)');
    expect(legacyGate).toContain('new Date(end + 15 * 60 * 1000).toISOString()');
    expect(legacyGate).toContain('query_not_before');
    expect(legacyGate).toContain('pageSize:1000');
    expect(legacyGate).toContain('page_count >= max_page_count');
    expect(legacyGate).toContain('--connect-timeout 10');
    expect(legacyGate).toContain('--max-time 60');
    expect(legacyGate).toContain('cleanup_logging_ephemera');
    expect(legacyGate).not.toContain('logging-auth-header');
    expect(queryStage).toContain('curl --disable --config -');
    expect(queryStage).toContain('unset logging_access_token');
    expect(queryStage).not.toMatch(/--header "Authorization: Bearer \$\{/u);
    expect(normalizedLegacyGate).toContain('contains no payload, bearer token, full API response');

    expect(t1Stage).toContain('set -euo pipefail');
    expect(t1Stage).toContain('set +x');
    expect(t1Stage).toContain('umask 077');
    expect(queryStage).toContain('set -euo pipefail');
    expect(queryStage).toContain('set +x');
    expect(queryStage).toContain('umask 077');
    expect(t1Stage).toContain('legacy_gate_dir="${LEGACY_GATE_DIR:?');
    expect(queryStage).toContain('legacy_gate_dir="${LEGACY_GATE_DIR:?');
    expect(t1Stage).toContain('verify_inventory_integrity t1');
    expect(queryStage).toContain('verify_inventory_integrity query');
    expect(t0Stage).toContain('verify_data_read_logging t0');
    expect(t0Stage).toContain('verify_logging_route t0');
    expect(t1Stage).toContain('verify_data_read_logging t1');
    expect(t1Stage).toContain('verify_logging_route t1');
    expect(queryStage).toContain('verify_data_read_logging query');
    expect(queryStage).toContain('verify_logging_route query');
    expect(t0Stage).toContain('gcloud --quiet logging read');
    expect(t1Stage).toContain('gcloud --quiet logging read');
    expect(queryStage).toContain('gcloud --quiet logging read');
    expect(legacyGate).toContain('--organization="${org_id}"');
    expect(legacyGate).toContain('--limit=1');
    expect(legacyGate).toContain("orgLogAccessProbe: 'PASS'");
    expect(legacyGate).toContain("projectPrivateLogAccessProbe: 'PASS'");
    expect(legacyGate).toContain(
      'logName=\\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Fdata_access\\"'
    );
    expect(legacyGate).toContain('gcloud --quiet logging sinks list');
    expect(legacyGate).toContain('interceptChildren');
    expect(legacyGate).toContain('enabledInterceptingSinkCount: 0');
    expect(legacyGate.match(/CLOUDSDK_CORE_DISABLE_PROMPTS=1/gu)).toHaveLength(13);
    expect(t0Stage.indexOf('verify_logging_route t0')).toBeLessThan(
      t0Stage.indexOf('run_package_control t0 dev')
    );
    expect(t1Stage.indexOf('verify_logging_route t1')).toBeLessThan(
      t1Stage.indexOf('run_package_control t1 dev')
    );
    expect(queryStage.indexOf('verify_logging_route query')).toBeLessThan(
      queryStage.indexOf('gcloud --quiet auth print-access-token')
    );
    expect(t1Stage.indexOf('verify_inventory_integrity t1')).toBeLessThan(
      t1Stage.indexOf('run_package_control t1 dev')
    );
    expect(t1Stage).toContain('preflight_no_stale_ephemera\nnode - "${legacy_gate_dir}/t0.json"');
    expect(queryStage.indexOf('verify_inventory_integrity query')).toBeLessThan(
      queryStage.indexOf('gcloud --quiet auth print-access-token')
    );
    expect(queryStage).toContain(
      'preflight_no_stale_ephemera\nnode - "${legacy_gate_dir}/t1.json"'
    );
    expect(queryStage.indexOf('trap cleanup_logging_ephemera EXIT')).toBeLessThan(
      queryStage.indexOf(': >"${legacy_gate_dir}/page-tokens"')
    );
    expect(queryStage.indexOf('trap cleanup_logging_ephemera EXIT')).toBeLessThan(
      queryStage.indexOf('gcloud --quiet auth print-access-token')
    );
    expect(queryStage).toContain('remove_logging_ephemera\ntrap - EXIT HUP INT TERM');
    expect(queryStage.lastIndexOf('remove_logging_ephemera')).toBeLessThan(
      queryStage.indexOf('mv -- "${query_staging_file}" "${legacy_gate_dir}/query.json"')
    );
    expect(legacyGate).toContain('actual_inventory_sha256');
    expect(legacyGate).toContain('"${actual_inventory_sha256}" == "${expected_inventory_sha256}"');
    expect(legacyGate).toContain('inventory.legacyNames');
    expect(legacyGate).toContain('inventory.reviewedSha');

    expect(legacyGate).toContain('cloudaudit.googleapis.com%2Factivity');
    expect(legacyGate).toContain(
      'logName=\\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Factivity\\"'
    );
    expect(legacyGate).toContain(
      'logName=\\"organizations/${org_id}/logs/cloudaudit.googleapis.com%2Factivity\\"'
    );
    expect(legacyGate).toContain('cloudresourcemanager.googleapis.com');
    expect(legacyGate).toContain('protoPayload.methodName=\\"SetIamPolicy\\"');
    expect(legacyGate).toContain('setIamPolicyEventCount === 0');
    expect(legacyGate).toContain(
      "const relevantServices = new Set(['secretmanager.googleapis.com', 'allServices'])"
    );
    expect(legacyGate).toContain("sink.name !== '_Default'");
    expect(legacyGate).toContain(
      "const disabled = hasOwn(sink, 'disabled') ? sink.disabled : false"
    );
    expect(legacyGate).toContain('disabled !== false');
    expect(legacyGate).toContain(
      "const exclusions = hasOwn(sink, 'exclusions') ? sink.exclusions : []"
    );
    expect(legacyGate).toContain('exclusions.length !== 0');
    expect(legacyGate).toContain("bucket.lifecycleState !== 'ACTIVE'");
    expect(legacyGate).toContain('bucket.retentionDays < 30');
    expect(legacyGate).toContain('logging.googleapis.com');
    expect(legacyGate).toContain('organizations/${org_id}');
    expect(legacyGate).toContain('resourceNames:[$project,$organization]');
    expect(legacyGate).toContain('loggingConfigMutationCount === 0');
    expect(legacyGate).toContain('parentPolicyMutationCount === 0');
    expect(legacyGate).toContain('projectHierarchyMutationCount === 0');
    expect(queryStage).toContain('org_logging_config_filter=');
    expect(queryStage).toContain('project_hierarchy_mutation_filter=');

    expect(legacyGate).toContain('entry.statusCode === 0');
    expect(legacyGate).toContain('expectedControlTuples');
    expect(legacyGate).toContain('new Set(actualControlTuples).size === 4');

    expect(legacyGate).toContain('preflight_no_stale_ephemera');
    expect(legacyGate).toContain('parentStatus.isSymbolicLink()');
    expect(legacyGate).toContain('Stale secret-migration ephemera forbids classification');
    expect(legacyGate).toContain("trap 'exit 129' HUP");
    expect(legacyGate).toContain("trap 'exit 130' INT");
    expect(legacyGate).toContain("trap 'exit 143' TERM");
    expect(legacyGate).toContain('trap cleanup_control_ephemera EXIT');
    expect(legacyGate).not.toMatch(/trap cleanup_control_ephemera EXIT HUP INT TERM/u);
    expect(legacyGate).not.toContain('source "${legacy_gate_dir}/gate-functions.sh"');
    expect(normalizedLegacyGate).not.toContain('restore the shell guards');
    expect(normalizedLegacyGate).not.toContain('restore the same shell');

    expect(legacyGate).not.toContain('node - "${operator_credential_file}" "${project_id}"');
    expect(normalizedLegacyGate).not.toContain(
      'expected package/native counts by approved principal'
    );
    expect(normalizedLegacyGate).toContain('all four DEV/PROD package positive-control counts');
  });

  it('fails the documented legacy classifier closed for invalid observation evidence', () => {
    const operations = read('docs/operations/secret-packages.md');
    const legacyGate = operations.slice(
      operations.indexOf('### Executable 34-name legacy-read gate'),
      operations.indexOf('## Rollback')
    );
    const classifierSection = legacyGate.slice(legacyGate.indexOf('Classify locally'));
    const classifierCommand = classifierSection.slice(
      classifierSection.indexOf('node - \\\n  "${legacy_gate_dir}/legacy-names.json"')
    );
    const classifierMatch = classifierCommand.match(/<<'NODE'\n([\s\S]*?)\nNODE\n```/u);
    expect(classifierMatch).not.toBeNull();
    const classifier = classifierMatch?.[1];
    if (classifier === undefined) throw new Error('Legacy classifier heredoc is missing');

    const terraform = read('terraform/environments/dev/main.tf');
    const inventoryBlock = terraform.match(
      /legacy_secret_container_names\s*=\s*toset\(\[([\s\S]*?)\]\)/u
    );
    if (inventoryBlock === null) throw new Error('Legacy inventory block is missing');
    const frozenNames = [...inventoryBlock[1].matchAll(/"(INTEXURAOS_[A-Z0-9_]+)"/gu)]
      .map((match) => match[1])
      .sort();
    expect(frozenNames).toHaveLength(34);

    const reviewedSha = 'c8c24cddfe652995f0d5c69dce0f912b3a2315b8';
    const inventorySha256 = '6324dca830a96cff486aeff3a1cf3cad9bf2aa42192b1957de6362015e1e5413';
    const projectId = 'intexuraos-dev-pbuchman';
    const projectNumber = '544224260556';
    const dataAccessLogName = `projects/${projectId}/logs/cloudaudit.googleapis.com%2Fdata_access`;
    const now = Date.now();
    const t0DevTime = now - 80 * 60 * 60 * 1000;
    const t0ProdTime = t0DevTime + 30_000;
    const t1DevTime = now - 60 * 60 * 1000;
    const t1ProdTime = t1DevTime + 30_000;
    const queryCompletedAt = new Date(now - 60_000).toISOString();
    const principal = {
      dev: 'ixos-secret-publisher-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
      prod: 'ixos-secret-publisher-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
    } as const;
    const secret = {
      dev: 'INTEXURAOS_SECRET_PACKAGE_DEV',
      prod: 'INTEXURAOS_SECRET_PACKAGE_PROD',
    } as const;
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'legacy-classifier-contract.'));

    const writeJson = (path: string, value: unknown): void => {
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    };
    const receipt = (boundary: 't0' | 't1', environment: 'dev' | 'prod', timestamp: number) => ({
      boundary,
      environment,
      before: new Date(timestamp - 10_000).toISOString(),
      after: new Date(timestamp + 10_000).toISOString(),
      secret: secret[environment],
      version: '2',
      principal: principal[environment],
    });
    const entry = (environment: 'dev' | 'prod', timestamp: number, statusCode = 0) => ({
      timestamp: new Date(timestamp).toISOString(),
      insertId: `${environment}-${timestamp}`,
      logName: dataAccessLogName,
      resourceType: 'audited_resource',
      serviceName: 'secretmanager.googleapis.com',
      methodName: 'google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion',
      resourceName: `projects/${projectId}/secrets/${secret[environment]}/versions/2`,
      principalEmail: principal[environment],
      statusCode,
    });

    const runClassifier = (
      caseName: string,
      options: {
        deniedControl?: boolean;
        duplicateReceipt?: boolean;
        invalidLoggingRoute?: boolean;
        invalidOrgSink?: boolean;
        invalidParentEvidence?: boolean;
        loggingMutation?: boolean;
        orgLoggingMutation?: boolean;
        parentPolicyMutation?: boolean;
        policyEvent?: boolean;
        projectHierarchyMutation?: boolean;
        mutateInventory?: boolean;
      } = {}
    ): string => {
      const caseDir = join(temporaryRoot, caseName);
      mkdirSync(caseDir, { mode: 0o700 });
      const names = options.mutateInventory
        ? [...frozenNames.slice(0, -1), 'INTEXURAOS_ZZZ_MUTATED_NAME'].sort()
        : frozenNames;
      const namesPath = join(caseDir, 'legacy-names.json');
      const inventoryPath = join(caseDir, 'inventory.json');
      const entriesPath = join(caseDir, 'entries.ndjson');
      const intervalPath = join(caseDir, 't1.json');
      const outputPath = join(caseDir, 'result.json');
      const auditConfigPaths = ['t0', 't1', 'query'].map((boundary) =>
        join(caseDir, `audit-config-${boundary}.json`)
      );
      const loggingRoutePaths = ['t0', 't1', 'query'].map((boundary) =>
        join(caseDir, `logging-route-${boundary}.json`)
      );
      const controlPaths = ['t0-dev', 't0-prod', 't1-dev', 't1-prod'].map((name) =>
        join(caseDir, `control-${name}.json`)
      );
      const controls = [
        receipt('t0', 'dev', t0DevTime),
        receipt('t0', 'prod', t0ProdTime),
        receipt('t1', 'dev', t1DevTime),
        receipt('t1', 'prod', t1ProdTime),
      ];
      if (options.duplicateReceipt === true) controls[3] = controls[2];
      const entries: Record<string, unknown>[] = [
        entry('dev', t0DevTime, options.deniedControl === true ? 7 : 0),
        entry('prod', t0ProdTime),
        entry('dev', t1DevTime),
        entry('prod', t1ProdTime),
      ];
      if (options.policyEvent === true) {
        entries.push({
          timestamp: new Date(t0ProdTime + 30_000).toISOString(),
          insertId: 'set-iam-policy',
          logName: `projects/${projectId}/logs/cloudaudit.googleapis.com%2Factivity`,
          resourceType: 'project',
          serviceName: 'cloudresourcemanager.googleapis.com',
          methodName: 'SetIamPolicy',
          resourceName: `projects/${projectId}`,
          principalEmail: 'migration-operator@example.invalid',
          statusCode: 0,
        });
      }
      if (options.loggingMutation === true) {
        entries.push({
          timestamp: new Date(t0ProdTime + 45_000).toISOString(),
          insertId: 'update-default-sink',
          logName: `projects/${projectId}/logs/cloudaudit.googleapis.com%2Factivity`,
          resourceType: 'audited_resource',
          serviceName: 'logging.googleapis.com',
          methodName: 'google.logging.v2.ConfigServiceV2.UpdateSink',
          resourceName: `projects/${projectId}/sinks/_Default`,
          principalEmail: 'migration-operator@example.invalid',
          statusCode: 0,
        });
      }
      if (options.orgLoggingMutation === true) {
        entries.push({
          timestamp: new Date(t0ProdTime + 50_000).toISOString(),
          insertId: 'update-org-sink',
          logName: 'organizations/398419898183/logs/cloudaudit.googleapis.com%2Factivity',
          resourceType: 'audited_resource',
          serviceName: 'logging.googleapis.com',
          methodName: 'google.logging.v2.ConfigServiceV2.UpdateSink',
          resourceName: 'organizations/398419898183/sinks/interceptor',
          principalEmail: 'migration-operator@example.invalid',
          statusCode: 0,
        });
      }
      if (options.parentPolicyMutation === true) {
        entries.push({
          timestamp: new Date(t0ProdTime + 60_000).toISOString(),
          insertId: 'set-org-iam-policy',
          logName: 'organizations/398419898183/logs/cloudaudit.googleapis.com%2Factivity',
          resourceType: 'organization',
          serviceName: 'cloudresourcemanager.googleapis.com',
          methodName: 'SetIamPolicy',
          resourceName: 'organizations/398419898183',
          principalEmail: 'migration-operator@example.invalid',
          statusCode: 0,
        });
      }
      if (options.projectHierarchyMutation === true) {
        entries.push({
          timestamp: new Date(t0ProdTime + 75_000).toISOString(),
          insertId: 'move-project',
          logName: `projects/${projectId}/logs/cloudaudit.googleapis.com%2Factivity`,
          resourceType: 'project',
          serviceName: 'cloudresourcemanager.googleapis.com',
          methodName: 'google.cloud.resourcemanager.v3.Projects.MoveProject',
          resourceName: `projects/${projectNumber}`,
          principalEmail: 'migration-operator@example.invalid',
          statusCode: 0,
        });
      }

      writeJson(namesPath, names);
      writeJson(inventoryPath, {
        reviewedSha,
        inventorySha256,
        legacyNameCount: 34,
        legacyNames: names,
      });
      writeFileSync(entriesPath, `${entries.map((value) => JSON.stringify(value)).join('\n')}\n`, {
        mode: 0o600,
      });
      controls.forEach((value, index) => writeJson(controlPaths[index], value));
      writeJson(intervalPath, {
        t0: new Date(t0DevTime - 10_000).toISOString(),
        t1: new Date(t1ProdTime + 10_000).toISOString(),
        query_not_before: new Date(t1ProdTime + 15 * 60 * 1000).toISOString(),
      });
      const boundaryTimes = [t0DevTime - 60_000, t1DevTime - 60_000, now - 120_000];
      const boundaries = ['t0', 't1', 'query'] as const;
      boundaries.forEach((boundary, index) => {
        writeJson(auditConfigPaths[index], {
          boundary,
          checkedAt: new Date(boundaryTimes[index]).toISOString(),
          projectParent: { type: 'organization', id: '398419898183' },
          projectPolicyReader: 'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
          orgPolicyReader:
            options.invalidParentEvidence === true && boundary === 't1'
              ? 'wrong-reader@example.invalid'
              : 'kontakt@pbuchman.com',
          orgLogAccessProbe: 'PASS',
          projectPrivateLogAccessProbe: 'PASS',
          effectiveConfigs: [
            {
              scope: `projects/${projectId}`,
              service: 'secretmanager.googleapis.com',
              exemptedMembers: [],
            },
          ],
          exemptedMembers: [],
          result: 'PASS',
        });
        writeJson(loggingRoutePaths[index], {
          boundary,
          checkedAt: new Date(boundaryTimes[index] + 10_000).toISOString(),
          sink: {
            name: '_Default',
            destination: `logging.googleapis.com/projects/${projectId}/locations/global/buckets/_Default`,
            filter:
              'NOT LOG_ID("cloudaudit.googleapis.com/activity") AND ' +
              'NOT LOG_ID("externalaudit.googleapis.com/activity") AND ' +
              'NOT LOG_ID("cloudaudit.googleapis.com/system_event") AND ' +
              'NOT LOG_ID("externalaudit.googleapis.com/system_event") AND ' +
              'NOT LOG_ID("cloudaudit.googleapis.com/access_transparency") AND ' +
              'NOT LOG_ID("externalaudit.googleapis.com/access_transparency")',
            disabled: options.invalidLoggingRoute === true && boundary === 't1',
            exclusions: [],
          },
          bucket: {
            name: `projects/${projectId}/locations/global/buckets/_Default`,
            lifecycleState: 'ACTIVE',
            retentionDays: 30,
            locked: false,
          },
          organization: {
            id: '398419898183',
            reader: 'kontakt@pbuchman.com',
            sinkCount: options.invalidOrgSink === true && boundary === 't1' ? 1 : 0,
            enabledInterceptingSinkCount:
              options.invalidOrgSink === true && boundary === 't1' ? 1 : 0,
          },
          result: 'PASS',
        });
      });

      return execFileSync(
        process.execPath,
        [
          '-',
          namesPath,
          inventoryPath,
          entriesPath,
          ...controlPaths,
          intervalPath,
          ...auditConfigPaths,
          ...loggingRoutePaths,
          projectId,
          projectNumber,
          '398419898183',
          '1',
          String(entries.length),
          queryCompletedAt,
          outputPath,
        ],
        { encoding: 'utf8', input: classifier, stdio: ['pipe', 'pipe', 'pipe'] }
      );
    };

    try {
      expect(JSON.parse(runClassifier('pass'))).toMatchObject({
        legacyCount: 0,
        setIamPolicyEventCount: 0,
        parentPolicyMutationCount: 0,
        loggingConfigMutationCount: 0,
        projectHierarchyMutationCount: 0,
        boundaryEvidence: { auditConfig: true, loggingRoute: true, timing: true },
        queryExecutedAt: queryCompletedAt,
        result: 'PASS',
      });
      expect(() => runClassifier('denied-control', { deniedControl: true })).toThrow();
      expect(() => runClassifier('duplicate-receipt', { duplicateReceipt: true })).toThrow();
      expect(() => runClassifier('policy-event', { policyEvent: true })).toThrow();
      expect(() => runClassifier('logging-mutation', { loggingMutation: true })).toThrow();
      expect(() => runClassifier('org-logging-mutation', { orgLoggingMutation: true })).toThrow();
      expect(() =>
        runClassifier('parent-policy-mutation', { parentPolicyMutation: true })
      ).toThrow();
      expect(() => runClassifier('invalid-logging-route', { invalidLoggingRoute: true })).toThrow();
      expect(() =>
        runClassifier('invalid-parent-evidence', { invalidParentEvidence: true })
      ).toThrow();
      expect(() => runClassifier('invalid-org-sink', { invalidOrgSink: true })).toThrow();
      expect(() =>
        runClassifier('project-hierarchy-mutation', { projectHierarchyMutation: true })
      ).toThrow();
      expect(() => runClassifier('mutated-inventory', { mutateInventory: true })).toThrow();
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

  it('documents Terraform adoption and least-privilege cleanup for the Cloud Build connection', () => {
    const operations = read('docs/operations/secret-packages.md');

    expect(operations).toContain('service-544224260556@gcp-sa-cloudbuild.iam.gserviceaccount.com');
    expect(operations).toContain('pbuchman-github-github-oauthtoken-8b04fa');
    expect(operations).toContain('roles/secretmanager.secretAccessor');
    expect(operations).toContain('roles/secretmanager.admin');
    expect(operations).toContain('fetchGitRefs');
    expect(operations).toContain('import');
    expect(operations).toContain('exactly two deletes');
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
