import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'deploy.yml');
const deployPath = resolve(repoRoot, 'scripts', 'hetzner', 'github-actions-deploy.sh');
const verifierPath = resolve(repoRoot, 'scripts', 'hetzner', 'verify-deployment-document.mjs');
const provisionPath = resolve(repoRoot, 'scripts', 'hetzner', 'provision.sh');
const runbookPath = resolve(repoRoot, 'docs', 'operations', 'hetzner-prod-runbook.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('PROD secret package deployment pin', () => {
  it('pins every third-party deployment action to an immutable commit SHA', () => {
    const workflow = read(workflowPath);
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)].map(
      (match) => match[1]
    );

    expect(actionReferences).toEqual([
      'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
      'google-github-actions/auth@c200f3691d83b41bf9bbd8638997a462592937ed',
      'google-github-actions/setup-gcloud@e427ad8a34f8676edf47cf7d7925499adf3eb74f',
    ]);
    expect(actionReferences.every((reference) => /@[0-9a-f]{40}$/u.test(reference))).toBe(true);
  });

  it('maps the protected GitHub Actions variable to the deployment process', () => {
    const workflow = read(workflowPath);

    expect(workflow).toContain('SECRET_PACKAGE_VERSION: ${{ vars.PROD_SECRET_PACKAGE_VERSION }}');
    expect(workflow).not.toMatch(/SECRET_PACKAGE_VERSION[^\n]*latest/u);
    expect(workflow.indexOf('SECRET_PACKAGE_VERSION:')).toBeLessThan(
      workflow.indexOf('scripts/hetzner/github-actions-deploy.sh')
    );
  });

  it('validates the canonical version before network/deployment work and pins the remote loader', () => {
    const script = read(deployPath);
    const validation = script.slice(
      script.indexOf('validate_inputs() {'),
      script.indexOf('\n}\n\nresolve_commit_metadata()')
    );
    const runtimeDependencies = script.slice(
      script.indexOf('prepare_runtime_dependencies() {'),
      script.indexOf('\n}\n\ndeploy_runtime()')
    );
    const main = script.slice(script.indexOf('main() {'));

    expect(validation).toContain('SECRET_PACKAGE_VERSION');
    expect(validation).toContain('^[1-9][0-9]*$');
    expect(main.indexOf('validate_inputs')).toBeLessThan(main.indexOf('setup_ssh'));
    expect(runtimeDependencies).toContain('load-secrets.sh --version');
    expect(runtimeDependencies).toContain('secret_package_version_quoted');
    expect(runtimeDependencies).not.toContain('latest');
  });

  it('stages and preflights the candidate before activation and compensates any post-activation failure', () => {
    const script = read(deployPath);
    const runbook = read(runbookPath).replace(/\s+/gu, ' ');
    const runtimeDependencies = script.slice(
      script.indexOf('prepare_runtime_dependencies() {'),
      script.indexOf('\n}\n\ndeploy_runtime()')
    );
    const activation = script.slice(
      script.indexOf('activate_secret_projection() {'),
      script.indexOf('\n}\n\nrun_secret_projection_canary()')
    );
    const canary = script.slice(
      script.indexOf('run_secret_projection_canary() {'),
      script.indexOf('\n}\n\nreload_previous_runtime()')
    );
    const compensation = script.slice(
      script.indexOf('compensate_secret_projection() {'),
      script.indexOf('\n}\n\ncleanup()')
    );
    const cleanup = script.slice(
      script.indexOf('cleanup() {'),
      script.indexOf('\n}\nrequire_command()')
    );
    const main = script.slice(script.indexOf('main() {'));

    expect(runtimeDependencies).toContain('--stage-only');
    expect(runtimeDependencies).toContain('--preflight');
    expect(runtimeDependencies).toContain('STAGED_SECRET_PROJECTION');
    expect(runtimeDependencies.indexOf('--stage-only')).toBeLessThan(
      runtimeDependencies.indexOf('--preflight')
    );
    expect(activation).toContain('--activate');
    expect(canary).toContain('code-agent');
    expect(canary).toContain('--only code-agent');
    expect(canary).toContain('--update-env');
    expect(canary).toContain('wait_for_code_agent_canary');
    expect(compensation).toContain('--rollback');
    expect(compensation).toContain('reload_previous_runtime');
    expect(compensation).toContain('verify_backend_readiness');
    expect(compensation).toContain('verify_runtime_readiness');
    expect(cleanup).toContain('compensate_secret_projection');
    expect(runbook).toContain('compensation always invokes the offline `--rollback` path');
    expect(main.indexOf('prepare_runtime_dependencies')).toBeLessThan(
      main.indexOf('activate_secret_projection')
    );
    expect(main.indexOf('activate_secret_projection')).toBeLessThan(main.indexOf('deploy_runtime'));
    expect(main.indexOf('activate_secret_projection')).toBeLessThan(
      main.indexOf('run_secret_projection_canary')
    );
    expect(main.indexOf('run_secret_projection_canary')).toBeLessThan(
      main.lastIndexOf('deploy_runtime')
    );
    expect(main.lastIndexOf('deploy_runtime')).toBeLessThan(
      main.lastIndexOf('verify_backend_readiness')
    );
  });

  it('reloads Alloy only after projection activation and again after projection rollback', () => {
    const script = read(deployPath);
    const runbook = read(runbookPath).replace(/\s+/gu, ' ');
    const runtimeDependencies = script.slice(
      script.indexOf('prepare_runtime_dependencies() {'),
      script.indexOf('\n}\n\nactivate_secret_projection()')
    );
    const activeAlloyReload = script.slice(
      script.indexOf('reload_alloy_for_active_projection() {'),
      script.indexOf('\n}\n\nrun_secret_projection_canary()')
    );
    const previousAlloyReload = script.slice(
      script.indexOf('reload_alloy_for_previous_projection() {'),
      script.indexOf('\n}\n\nreload_previous_runtime()')
    );
    const compensation = script.slice(
      script.indexOf('compensate_secret_projection() {'),
      script.indexOf('\n}\n\ncleanup()')
    );
    const main = script.slice(script.indexOf('main() {'));

    expect(runtimeDependencies).not.toContain('install-grafana-alloy.sh');
    expect(activeAlloyReload).toContain(
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
    );
    expect(previousAlloyReload).toContain('run_remote_at "${PREVIOUS_RELEASE_DIR}"');
    expect(previousAlloyReload).toContain(
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
    );
    expect(main.indexOf('activate_secret_projection')).toBeLessThan(
      main.indexOf('reload_alloy_for_active_projection')
    );
    expect(main.indexOf('reload_alloy_for_active_projection')).toBeLessThan(
      main.indexOf('run_secret_projection_canary')
    );
    expect(compensation.indexOf('--rollback')).toBeLessThan(
      compensation.indexOf('reload_alloy_for_previous_projection')
    );
    expect(compensation.indexOf('reload_alloy_for_previous_projection')).toBeLessThan(
      compensation.indexOf('reload_previous_runtime')
    );
    expect(runbook).toContain('Alloy is not restarted during staging or preflight');
    expect(runbook).toContain('reloads Alloy against the restored `.env.prod`');
  });

  it('compensates the complete projection and restarted runtime after post-activation health failure', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deployment-compensation-'));
    const statePath = join(directory, 'current');
    const tracePath = join(directory, 'trace');
    const candidate = 'prod-v8-feedface-' + 'c'.repeat(40);
    const previous = 'prod-v7-deadbeef-' + 'a'.repeat(40);
    writeFileSync(statePath, candidate);
    writeFileSync(tracePath, '');
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'source "$1"',
          'set +e',
          'SECRET_PROJECTION_ACTIVATED=true',
          'DEPLOYMENT_COMPLETED=false',
          `STAGED_SECRET_PROJECTION="${candidate}"`,
          `PREVIOUS_SECRET_PROJECTION="${previous}"`,
          'PREVIOUS_RELEASE_DIR="/opt/intexuraos/releases/' + 'b'.repeat(40) + '"',
          'PREVIOUS_RELEASE_SHA="' + 'b'.repeat(40) + '"',
          'STATE_FILE="$2"',
          'TRACE_FILE="$3"',
          'run_remote() { case "$1" in *"--current-release"*) cat "$STATE_FILE" ;; *"--rollback"*) printf "%s" "$PREVIOUS_SECRET_PROJECTION" > "$STATE_FILE"; printf "remote:%s\\n" "$1" >> "$TRACE_FILE" ;; *) printf "remote:%s\\n" "$1" >> "$TRACE_FILE" ;; esac; }',
          'reload_alloy_for_previous_projection() { printf "reload-previous-alloy\\n" >> "$TRACE_FILE"; }',
          'reload_previous_runtime() { printf "reload-previous\\n" >> "$TRACE_FILE"; }',
          'verify_backend_readiness() { printf "backend-health\\n" >> "$TRACE_FILE"; }',
          'verify_runtime_readiness() { printf "runtime-health\\n" >> "$TRACE_FILE"; }',
          'post_activation_health() { return 23; }',
          'post_activation_health',
          'cleanup',
          'exit $?',
        ].join('; '),
        'deployment-compensation-test',
        deployPath,
        statePath,
        tracePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    try {
      const trace = readFileSync(tracePath, 'utf8');
      expect(result.status).toBe(23);
      expect(trace).toContain('--rollback');
      expect(trace).toContain('reload-previous-alloy');
      expect(trace).toContain('reload-previous');
      expect(trace).toContain('backend-health');
      expect(trace).toContain('runtime-health');
      expect(readFileSync(statePath, 'utf8')).toBe(previous);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reconciles an SSH disconnect after remote projection activation and rolls back the exact candidate', () => {
    const candidate = 'prod-v8-feedface-' + 'a'.repeat(40);
    const previous = 'prod-v7-deadbeef-' + 'b'.repeat(40);
    const directory = mkdtempSync(join(tmpdir(), 'secret-projection-activation-after-'));
    const statePath = join(directory, 'current');
    const tracePath = join(directory, 'trace');
    writeFileSync(statePath, previous);
    writeFileSync(tracePath, '');
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'source "$1"',
          `STAGED_SECRET_PROJECTION="${candidate}"`,
          `PREVIOUS_SECRET_PROJECTION="${previous}"`,
          'STATE_FILE="$2"',
          'TRACE_FILE="$3"',
          'run_remote() { case "$1" in *"--activate"*) printf "%s" "$STAGED_SECRET_PROJECTION" > "$STATE_FILE"; printf "activate-disconnected\\n" >> "$TRACE_FILE"; return 255 ;; *"--current-release"*) printf "reconcile-current\\n" >> "$TRACE_FILE"; cat "$STATE_FILE" ;; *"--rollback"*) printf "%s" "$PREVIOUS_SECRET_PROJECTION" > "$STATE_FILE"; printf "rollback-previous\\n" >> "$TRACE_FILE" ;; *) printf "remote:%s\\n" "$1" >> "$TRACE_FILE" ;; esac; }',
          'reload_alloy_for_previous_projection() { printf "reload-previous-alloy\\n" >> "$TRACE_FILE"; }',
          'reload_previous_runtime() { printf "reload-previous\\n" >> "$TRACE_FILE"; }',
          'verify_backend_readiness() { printf "backend-health\\n" >> "$TRACE_FILE"; }',
          'verify_runtime_readiness() { printf "runtime-health\\n" >> "$TRACE_FILE"; }',
          'trap cleanup EXIT',
          'activate_secret_projection',
        ].join('; '),
        'deployment-ambiguous-activation-test',
        deployPath,
        statePath,
        tracePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    try {
      const trace = readFileSync(tracePath, 'utf8');
      expect(result.status, result.stderr).toBe(255);
      expect(trace).toContain('activate-disconnected');
      expect(trace).toContain('reconcile-current');
      expect(trace).toContain('rollback-previous');
      expect(trace).toContain('reload-previous-alloy');
      expect(readFileSync(statePath, 'utf8')).toBe(previous);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('runs offline rollback recovery after activation interruption while current still names the previous release', () => {
    const candidate = 'prod-v8-feedface-' + 'a'.repeat(40);
    const previous = 'prod-v7-deadbeef-' + 'b'.repeat(40);
    const directory = mkdtempSync(join(tmpdir(), 'secret-projection-activation-before-'));
    const statePath = join(directory, 'current');
    const tracePath = join(directory, 'trace');
    const markerPath = join(directory, 'stable-link-transaction');
    writeFileSync(statePath, previous);
    writeFileSync(tracePath, '');
    writeFileSync(markerPath, 'committed-marker-with-managed-backups');
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'source "$1"',
          `STAGED_SECRET_PROJECTION="${candidate}"`,
          `PREVIOUS_SECRET_PROJECTION="${previous}"`,
          'STATE_FILE="$2"',
          'TRACE_FILE="$3"',
          'MARKER_FILE="$4"',
          'run_remote() { case "$1" in *"--activate"*) printf "activate-disconnected\\n" >> "$TRACE_FILE"; return 255 ;; *"--current-release"*) printf "reconcile-current\\n" >> "$TRACE_FILE"; cat "$STATE_FILE" ;; *"--rollback"*) rm -f -- "$MARKER_FILE"; printf "rollback-recovered-transaction\\n" >> "$TRACE_FILE" ;; *) printf "unexpected-remote:%s\\n" "$1" >> "$TRACE_FILE" ;; esac; }',
          'reload_alloy_for_previous_projection() { printf "unexpected-alloy-reload\\n" >> "$TRACE_FILE"; }',
          'reload_previous_runtime() { printf "unexpected-runtime-reload\\n" >> "$TRACE_FILE"; }',
          'verify_backend_readiness() { printf "unexpected-backend-health\\n" >> "$TRACE_FILE"; }',
          'verify_runtime_readiness() { printf "unexpected-runtime-health\\n" >> "$TRACE_FILE"; }',
          'trap cleanup EXIT',
          'activate_secret_projection',
        ].join('; '),
        'deployment-ambiguous-activation-test',
        deployPath,
        statePath,
        tracePath,
        markerPath,
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    try {
      const trace = readFileSync(tracePath, 'utf8');
      expect(result.status, result.stderr).toBe(255);
      expect(trace).toContain('activate-disconnected');
      expect(trace).toContain('reconcile-current');
      expect(trace).toContain('rollback-recovered-transaction');
      expect(trace).not.toContain('unexpected-');
      expect(readFileSync(statePath, 'utf8')).toBe(previous);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not reload Alloy from a previous release when projection rollback fails', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'source "$1"',
          'set +e',
          'SECRET_PROJECTION_ACTIVATED=true',
          'STAGED_SECRET_PROJECTION="prod-v8-feedface-' + 'b'.repeat(40) + '"',
          'PREVIOUS_SECRET_PROJECTION="prod-v7-deadbeef-' + 'a'.repeat(40) + '"',
          'run_remote() { case "$1" in *"--current-release"*) printf "%s" "$STAGED_SECRET_PROJECTION" ;; *) printf "rollback-attempt\\n"; return 31 ;; esac; }',
          'reload_alloy_for_previous_projection() { printf "unexpected-alloy-reload\\n"; }',
          'reload_previous_runtime() { return 0; }',
          'verify_backend_readiness() { return 0; }',
          'verify_runtime_readiness() { return 0; }',
          'compensate_secret_projection',
          'printf "status=%s\\n" "$?"',
          'exit 0',
        ].join('; '),
        'deployment-alloy-rollback-test',
        deployPath,
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('rollback-attempt');
    expect(result.stdout).toContain('status=1');
    expect(result.stdout).not.toContain('unexpected-alloy-reload');
  });

  it('does not run external secret/runtime compensation after durable public admission', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'source "$1"',
          'set +e',
          'REMOTE_TERRAFORM_BIN_DIR="/opt/intexuraos/.deployment-tools/terraform/1.5.0"',
          'REMOTE_RELEASE_DIR="/opt/intexuraos/releases/' + 'a'.repeat(40) + '"',
          'PREVIOUS_RELEASE_DIR="/opt/intexuraos/releases/' + 'b'.repeat(40) + '"',
          'PREVIOUS_RELEASE_SHA="' + 'b'.repeat(40) + '"',
          'COMMIT_SHA_VALUE="' + 'a'.repeat(40) + '"',
          'TESTED_TREE_VALUE="' + 'c'.repeat(40) + '"',
          'WORKFLOW_RUN_ID_VALUE="123"',
          'RELEASE_MANIFEST_HASH="' + 'd'.repeat(64) + '"',
          'run_remote() { return 31; }',
          'read_remote_cutover_status() { printf admitted; }',
          'run_message_digest_cutover',
          'cutover_status=$?',
          'printf "cutover=%s irreversible=%s\\n" "$cutover_status" "${CUTOVER_ADMISSION_IRREVERSIBLE:-false}"',
          'SECRET_PROJECTION_ACTIVATED=true',
          'DEPLOYMENT_COMPLETED=false',
          'compensate_secret_projection() { printf "unexpected-compensation\\n"; }',
          'synthetic_post_admission_failure() { return 23; }',
          'synthetic_post_admission_failure',
          'cleanup',
          'printf "cleanup=%s\\n" "$?"',
          'exit 0',
        ].join('; '),
        'deployment-admission-test',
        deployPath,
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('cutover=31 irreversible=true');
    expect(result.stdout).toContain('cleanup=23');
    expect(result.stdout).not.toContain('unexpected-compensation');
  });

  it('restores the prior web release and nginx config during ordinary compensation', () => {
    const previousSha = 'b'.repeat(40);
    const directory = mkdtempSync(join(tmpdir(), 'deployment-web-compensation-'));
    const statePath = join(directory, 'current');
    const tracePath = join(directory, 'trace');
    const candidate = 'prod-v8-feedface-' + 'c'.repeat(40);
    const previous = 'prod-v7-deadbeef-' + 'a'.repeat(40);
    writeFileSync(statePath, candidate);
    writeFileSync(tracePath, '');
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'source "$1"',
          'set +e',
          'SECRET_PROJECTION_ACTIVATED=true',
          'DEPLOYMENT_COMPLETED=false',
          'ACTIVATION_MODE=ordinary',
          `STAGED_SECRET_PROJECTION="${candidate}"`,
          `PREVIOUS_SECRET_PROJECTION="${previous}"`,
          `PREVIOUS_RELEASE_DIR="/opt/intexuraos/releases/${previousSha}"`,
          `PREVIOUS_RELEASE_SHA="${previousSha}"`,
          `PREVIOUS_WEB_RELEASE="/var/www/intexuraos/web/releases/${previousSha}"`,
          'WEB_AND_EDGE_MUTATION_STARTED=true',
          'DEPLOY_NGINX=true',
          'STATE_FILE="$2"',
          'TRACE_FILE="$3"',
          'run_remote() { case "$1" in *"--current-release"*) cat "$STATE_FILE" ;; *"--rollback"*) printf "%s" "$PREVIOUS_SECRET_PROJECTION" > "$STATE_FILE"; printf "remote:%s\\n" "$1" >> "$TRACE_FILE" ;; *) printf "remote:%s\\n" "$1" >> "$TRACE_FILE" ;; esac; }',
          'run_remote_at() { printf "remote-at:%s:%s\\n" "$1" "$2" >> "$TRACE_FILE"; }',
          'verify_backend_readiness() { printf "backend-health\\n" >> "$TRACE_FILE"; }',
          'verify_runtime_readiness() { printf "runtime-health\\n" >> "$TRACE_FILE"; }',
          'post_web_health() { return 23; }',
          'post_web_health',
          'cleanup',
          'exit $?',
        ].join('; '),
        'deployment-web-compensation-test',
        deployPath,
        statePath,
        tracePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    try {
      const trace = readFileSync(tracePath, 'utf8');
      expect(result.status).toBe(23);
      expect(trace).toContain(`ln -sfn /opt/intexuraos/releases/${previousSha}`);
      expect(trace).toContain('/opt/intexuraos/current');
      expect(trace).toContain(`/var/www/intexuraos/web/releases/${previousSha}`);
      expect(trace).toContain('/var/www/intexuraos/web/current');
      expect(trace).toContain('deploy-nginx.sh --message-digests-public');
      expect(readFileSync(statePath, 'utf8')).toBe(previous);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires cutover-complete retries to match active projection metadata', () => {
    const script = read(deployPath);
    const main = script.slice(script.indexOf('main() {'));
    const cutoverCompleteStart = main.indexOf(
      'if [[ "${ACTIVATION_MODE}" == "cutover_complete" ]]'
    );
    const cutoverCompleteBranch = main.slice(
      cutoverCompleteStart,
      main.indexOf('\n  else', cutoverCompleteStart)
    );
    expect(cutoverCompleteBranch).toContain('verify_active_secret_projection_version');

    const runVerification = (activeVersion: string): ReturnType<typeof spawnSync> =>
      spawnSync(
        'bash',
        [
          '-c',
          'source "$1"; run_remote() { [[ "$1" == *"sudo -n node --input-type=module"* ]] || return 41; printf "%s" "$ACTIVE_VERSION"; }; verify_active_secret_projection_version',
          'deployment-active-package-test',
          deployPath,
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, ACTIVE_VERSION: activeVersion, SECRET_PACKAGE_VERSION: '17' },
        }
      );

    expect(runVerification('17').status).toBe(0);
    const mismatch = runVerification('18');
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain('active PROD secret package version does not match');
  });

  it.each(['', 'latest', '0', '01', '-1', '1.0'])(
    'fails deployment input validation for non-canonical version %s',
    (version) => {
      const result = spawnSync(
        'bash',
        ['-c', 'source "$1"; validate_inputs', 'deployment-pin-test', deployPath],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            DEPLOY_NGINX: 'false',
            HETZNER_DEPLOY_SSH_PRIVATE_KEY: 'synthetic-test-key',
            SECRET_PACKAGE_VERSION: version,
          },
        }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('exact positive numeric version');
    }
  );

  it('accepts a canonical deployment version during input validation', () => {
    const result = spawnSync(
      'bash',
      ['-c', 'source "$1"; validate_inputs', 'deployment-pin-test', deployPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DEPLOY_NGINX: 'false',
          HETZNER_DEPLOY_SSH_PRIVATE_KEY: 'synthetic-test-key',
          SECRET_PACKAGE_VERSION: '17',
        },
      }
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it('records the numeric pin in deployment.json and verifies the same value', () => {
    const script = read(deployPath);
    const withdrawal = script.slice(
      script.indexOf('withdraw_deployment_metadata() {'),
      script.indexOf('\n}\n\nrun_remote_deploy_web()')
    );
    const publisher = script.slice(
      script.indexOf('publish_deployment_metadata() {'),
      script.indexOf('\n}\n\nverify_non_404_route()')
    );
    const verifierCall = script.slice(
      script.indexOf('verify_deployment_document() {'),
      script.indexOf('\n}\n\nverify_runtime_readiness()')
    );

    expect(publisher).toContain('"secretPackageVersion":"%s"');
    expect(publisher).toContain('"${SECRET_PACKAGE_VERSION}"');
    expect(withdrawal).toContain('${WEB_RELEASES_ROOT%/}/${COMMIT_SHA_VALUE}/deployment.json');
    expect(withdrawal).not.toContain('"${DEPLOYMENT_JSON_PATH}"');
    expect(verifierCall).toContain('"${SECRET_PACKAGE_VERSION}"');
    expect(verifierCall).toContain('verify-deployment-document.mjs');
  });

  it('requires a canonical pin when provisioning secrets and forwards it to the loader', () => {
    const script = read(provisionPath);
    const main = script.slice(script.indexOf('main() {'));

    expect(script).toContain('SECRET_PACKAGE_VERSION');
    expect(script).toContain('--version');
    expect(script).toContain('--secret-package-version');
    expect(script).toContain('^[1-9][0-9]*$');
    expect(main).toContain('load-secrets.sh" --version "${SECRET_PACKAGE_VERSION}"');
    expect(main).not.toContain('versions/latest');
  });

  it.each(['', 'latest', '0', '01', '-1', '1.0'])(
    'fails provisioning before privileged operations for non-canonical version %s',
    (version) => {
      const result = spawnSync('bash', [provisionPath, '--skip-certbot', '--version', version], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          INTEXURAOS_ENVIRONMENT: 'prod',
          SECRET_PACKAGE_VERSION: '',
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('exact positive numeric version');
      expect(result.stdout).not.toContain('Installing');
    }
  );

  it('accepts only an exact deployment document including the expected package version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'secret-package-deployment-pin-'));
    const headersPath = join(directory, 'headers.txt');
    const sha = 'a'.repeat(40);
    const runId = '12345';
    const version = '17';
    const headers =
      'HTTP/2 200\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n';
    writeFileSync(headersPath, headers, 'utf8');
    const validDocument = {
      commitSha: sha,
      workflowRunId: runId,
      deployedAt: '2026-08-13T12:00:00Z',
      secretPackageVersion: version,
    };
    const verify = (document: unknown, expectedVersion = version): ReturnType<typeof spawnSync> =>
      spawnSync('node', [verifierPath, sha, runId, expectedVersion, headersPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        input: JSON.stringify(document),
      });

    try {
      expect(verify(validDocument).status).toBe(0);
      expect(verify(validDocument, 'latest').status).not.toBe(0);
      expect(verify(validDocument, '01').status).not.toBe(0);
      expect(verify({ ...validDocument, secretPackageVersion: '18' }).status).not.toBe(0);
      expect(verify({ ...validDocument, secretPackageVersion: 'latest' }).status).not.toBe(0);
      expect(verify({ ...validDocument, extra: true }).status).not.toBe(0);
      const { secretPackageVersion: _omitted, ...withoutVersion } = validDocument;
      expect(verify(withoutVersion).status).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
