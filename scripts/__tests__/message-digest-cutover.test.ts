import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCutoverEstimateFits,
  assertMigration128CutoverReadiness,
  computeCutoverWindow,
  deriveMessageDigestMigrationId,
  estimateCutoverDurationSeconds,
  parseTestedTreeTrailer,
  validateTerraformPlan,
  verifyReleaseAttestation,
} from '../hetzner/message-digest-cutover-support.mjs';
import { renderMessageDigestCandidateConfig } from '../hetzner/render-message-digest-candidate.mjs';
import {
  acquireCutoverLease,
  assertPreAdmissionCompensationAllowed,
  beginPublicAdmission,
  beginCutoverCompensation,
  completeCutoverCheckpoint,
  MESSAGE_DIGEST_CUTOVER_STEPS,
  markCutoverComplete,
  markCutoverCompensated,
  readCutoverState,
} from '../hetzner/message-digest-cutover-state.mjs';
import { hashReleaseTree } from '../hetzner/hash-release-tree.mjs';

const repoRoot = resolve(__dirname, '..', '..');
const cutoverPath = resolve(repoRoot, 'scripts/hetzner/cutover-message-digests.sh');
const templateVerifierPath = resolve(
  repoRoot,
  'scripts/hetzner/verify-whatsapp-message-digest-template.mjs'
);
const cutoverStatePath = resolve(repoRoot, 'scripts/hetzner/message-digest-cutover-state.mjs');
const deployPath = resolve(repoRoot, 'scripts/hetzner/github-actions-deploy.sh');
const workflowPath = resolve(repoRoot, '.github/workflows/deploy.yml');
const nginxDeployPath = resolve(repoRoot, 'scripts/hetzner/deploy-nginx.sh');
const nginxConfigPath = resolve(repoRoot, 'scripts/hetzner/nginx/intexuraos.conf');
const activeIngressPath = resolve(
  repoRoot,
  'scripts/hetzner/nginx/message-digests-public-active.conf'
);
const candidateUnavailableIngressPath = resolve(
  repoRoot,
  'scripts/hetzner/nginx/message-digests-candidate-unavailable.conf'
);
const fullHoldIngressPath = resolve(
  repoRoot,
  'scripts/hetzner/nginx/message-digests-full-cutover-hold.conf'
);

describe('Message Digest release attestation', () => {
  it('requires one exact Tested-Tree trailer across PR head, merge, and staged release', () => {
    const tree = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const mergeSha = 'c'.repeat(40);
    const commitMessage = `feat: add WhatsApp message digests\n\nTested-Tree: ${tree}`;

    expect(parseTestedTreeTrailer(commitMessage)).toBe(tree);
    expect(
      verifyReleaseAttestation({
        mergeSha,
        mergeTree: tree,
        prHeadSha: headSha,
        prHeadTree: tree,
        prHeadCommitMessage: commitMessage,
        stagedTree: tree,
      })
    ).toEqual({ mergeSha, prHeadSha: headSha, testedTree: tree });
    expect(deriveMessageDigestMigrationId(mergeSha)).toBe(`mdm_${mergeSha}`);

    expect(() => parseTestedTreeTrailer(`${commitMessage}\nTested-Tree: ${tree}`)).toThrow(
      'CUTOVER_TESTED_TREE_TRAILER_INVALID'
    );
    expect(() =>
      verifyReleaseAttestation({
        mergeSha,
        mergeTree: 'd'.repeat(40),
        prHeadSha: headSha,
        prHeadTree: tree,
        prHeadCommitMessage: commitMessage,
        stagedTree: tree,
      })
    ).toThrow('CUTOVER_TREE_MISMATCH');
  });

  it('starts its deadline at the actual cutover start and reserves rollback margin', () => {
    const window = computeCutoverWindow('2026-07-29T01:05:00.000Z');
    expect(window).toEqual({
      cutoverStart: '2026-07-29T01:05:00.000Z',
      cutoverDeadline: '2026-07-29T03:05:00.000Z',
      nextLegacyBoundary: '2026-07-30T01:00:00.000Z',
    });

    const estimate = estimateCutoverDurationSeconds({ replayDates: 25, terraformChanges: 11 });
    expect(estimate.totalSeconds).toBeLessThan(2 * 60 * 60);
    expect(estimate.rollbackMarginSeconds).toBeGreaterThanOrEqual(30 * 60);
    expect(() => assertCutoverEstimateFits(window, estimate)).not.toThrow();
    expect(() =>
      assertCutoverEstimateFits(window, { ...estimate, totalSeconds: 2 * 60 * 60 + 1 })
    ).toThrow('CUTOVER_ESTIMATE_EXCEEDS_DEADLINE');
  });

  it('hashes immutable release inputs while ignoring runtime-generated directories', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-release-tree-'));
    try {
      writeFileSync(resolve(directory, 'package.json'), '{"name":"release"}\n', 'utf8');
      mkdirSync(resolve(directory, 'scripts'));
      writeFileSync(resolve(directory, 'scripts', 'deploy.sh'), '#!/bin/sh\n', {
        encoding: 'utf8',
        mode: 0o755,
      });
      const immutableHash = hashReleaseTree(directory);

      for (const generatedDirectory of ['node_modules', 'dist', 'coverage', '.terraform']) {
        mkdirSync(resolve(directory, generatedDirectory));
        writeFileSync(resolve(directory, generatedDirectory, 'generated.txt'), 'runtime\n', 'utf8');
      }
      expect(hashReleaseTree(directory)).toBe(immutableHash);

      writeFileSync(resolve(directory, 'package.json'), '{"name":"changed"}\n', 'utf8');
      expect(hashReleaseTree(directory)).not.toBe(immutableHash);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('Message Digest runtime environment loading', () => {
  it('parses dotenv without executing shell and preserves single-quoted JSON exactly', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-runtime-env-'));
    const envPath = resolve(directory, '.env.prod');
    const shellExpansionSentinel = resolve(directory, 'shell-expansion-ran');
    const privateKey = JSON.stringify({
      crv: 'Ed25519',
      d: 'private-material',
      kid: '$HOME-is-literal',
      kty: 'OKP',
    });

    try {
      writeFileSync(
        envPath,
        [
          "INTEXURAOS_GCP_PROJECT_ID='safe-project'",
          `INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY='${privateKey}'`,
          `INTEXURAOS_SHELL_PAYLOAD=$(touch "${shellExpansionSentinel}")`,
          '',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o600 }
      );

      const result = runShellLibrary(
        cutoverPath,
        `
load_runtime_environment
node -e 'process.stdout.write(JSON.stringify({ projectId: process.env.PROJECT_ID, nodeEnv: process.env.NODE_ENV, privateKey: process.env.INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY, shellPayload: process.env.INTEXURAOS_SHELL_PAYLOAD }))'
`,
        { ENV_FILE: envPath, RELEASE_DIR: repoRoot }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        projectId: 'safe-project',
        nodeEnv: 'production',
        privateKey,
        shellPayload: `$(touch "${shellExpansionSentinel}")`,
      });
      expect(existsSync(shellExpansionSentinel)).toBe(false);
      expect(readFileSync(cutoverPath, 'utf8')).not.toContain('source "${ENV_FILE}"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('Message Digest mutation admission', () => {
  it('checks the approved provider template before acquiring or mutating durable cutover state', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-template-preflight-'));
    const tracePath = resolve(directory, 'trace.txt');
    try {
      const result = runShellLibrary(
        cutoverPath,
        `
TRACE_FILE="$TEST_TRACE_FILE"
trace() { printf '%s\n' "$1" >> "$TRACE_FILE"; }
require_command() { :; }
validate_inputs() { trace validate; }
load_runtime_environment() { trace load-environment; }
verify_whatsapp_message_digest_template() { trace verify-template; return 1; }
acquire_durable_lease() { trace acquire-lease; }
rollback_pre_admission() { trace rollback; }
main
`,
        { TEST_TRACE_FILE: tracePath }
      );

      expect(result.status).not.toBe(0);
      expect(readFileSync(tracePath, 'utf8').trim().split('\n')).toEqual([
        'validate',
        'load-environment',
        'verify-template',
      ]);

      const cutover = readFileSync(cutoverPath, 'utf8');
      const main = cutover.slice(cutover.indexOf('main() {'));
      expect(main.indexOf('load_runtime_environment')).toBeLessThan(
        main.indexOf('verify_whatsapp_message_digest_template')
      );
      expect(main.indexOf('verify_whatsapp_message_digest_template')).toBeLessThan(
        main.indexOf('trap on_error ERR')
      );
      expect(main.indexOf('verify_whatsapp_message_digest_template')).toBeLessThan(
        main.indexOf('acquire_durable_lease')
      );
      expect(cutover).toContain(
        `TEMPLATE_VERIFIER="\${RELEASE_DIR}/scripts/hetzner/${
          templateVerifierPath.split('/').at(-1) ?? ''
        }"`
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back before activation when the second provider-template check fails', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-template-activation-'));
    const tracePath = resolve(directory, 'trace.txt');
    try {
      const result = runShellLibrary(
        cutoverPath,
        `
TRACE_FILE="$TEST_TRACE_FILE"
trace() { printf '%s\n' "$1" >> "$TRACE_FILE"; }
verify_whatsapp_message_digest_template() { trace verify-template; return 1; }
run_migration() { trace "migration:$*"; }
rollback_pre_admission() { trace rollback; }
trap on_error ERR
migration_activate
`,
        { TEST_TRACE_FILE: tracePath }
      );

      expect(result.status).not.toBe(0);
      expect(readFileSync(tracePath, 'utf8').trim().split('\n')).toEqual([
        'verify-template',
        'rollback',
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts only the fresh or already-applied migration 128 cutover states', () => {
    expect(assertMigration128CutoverReadiness(migrationStatus128('pending'))).toEqual({
      migrationId: '128',
      mode: 'pending',
    });
    expect(assertMigration128CutoverReadiness(migrationStatus128('applied'))).toEqual({
      migrationId: '128',
      mode: 'already_applied',
    });
    expect(() =>
      assertMigration128CutoverReadiness(migrationStatus128('pending', { '127': 'pending' }))
    ).toThrow('CUTOVER_PENDING_MIGRATIONS_INVALID');
    expect(() =>
      assertMigration128CutoverReadiness(
        migrationStatus128('applied').replace('message-digest-service-indexes', 'renamed-digest')
      )
    ).toThrow('CUTOVER_PENDING_MIGRATIONS_INVALID');
    expect(() => assertMigration128CutoverReadiness(migrationStatus128('failed'))).toThrow(
      'CUTOVER_PENDING_MIGRATIONS_INVALID'
    );
    expect(() =>
      assertMigration128CutoverReadiness(
        `${migrationStatus128('applied')}\n129 | later | pending | -`
      )
    ).toThrow('CUTOVER_PENDING_MIGRATIONS_INVALID');
    expect(() =>
      assertMigration128CutoverReadiness('128 | message-digest-service-indexes | pending | -')
    ).toThrow('CUTOVER_PENDING_MIGRATIONS_INVALID');
  });

  it('requires exact forward and inverse-proof Terraform plans plus safe rollback subsets', () => {
    expect(
      validateTerraformPlan('dev', {
        resource_changes: [
          change('google_pubsub_topic.message_digest_runs', ['create']),
          change('google_pubsub_topic_iam_member.message_digest_publishes_runs', ['create']),
          change('google_pubsub_topic_iam_member.message_digest_publishes_whatsapp', ['create']),
        ],
      })
    ).toHaveLength(3);

    expect(
      validateTerraformPlan('prod', {
        resource_changes: [
          change('google_pubsub_topic.hetzner_push_dlq["message_digest_runs"]', ['create']),
          change('google_pubsub_subscription.hetzner_push_dlq_inspect["message_digest_runs"]', [
            'create',
          ]),
          change(
            'google_pubsub_topic_iam_member.hetzner_push_dlq_publisher["message_digest_runs"]',
            ['create']
          ),
          change('google_pubsub_subscription.hetzner_push["message_digest_runs"]', ['create']),
          change(
            'google_pubsub_subscription_iam_member.hetzner_push_dlq_subscriber["message_digest_runs"]',
            ['create']
          ),
          change('google_cloud_scheduler_job.hetzner_http["message_digest_tick"]', ['create']),
          change(
            'google_cloud_scheduler_job.hetzner_http["mobile_notifications_digest_yesterday"]',
            ['delete']
          ),
        ],
      })
    ).toHaveLength(7);

    expect(() =>
      validateTerraformPlan('dev', {
        resource_changes: [change('google_firestore_database.default', ['delete'])],
      })
    ).toThrow('CUTOVER_TERRAFORM_PLAN_UNSAFE');

    expect(validateTerraformPlan('dev-inverse', { resource_changes: [] })).toEqual([]);
    expect(
      validateTerraformPlan('dev-inverse', {
        resource_changes: [
          change('google_pubsub_topic.message_digest_runs', ['delete']),
          change('google_service_account.message_digest_service', ['no-op']),
        ],
      })
    ).toEqual([{ address: 'google_pubsub_topic.message_digest_runs', action: 'delete' }]);
    expect(() =>
      validateTerraformPlan('dev-inverse', {
        resource_changes: [change('google_firestore_database.default', ['delete'])],
      })
    ).toThrow('CUTOVER_TERRAFORM_PLAN_UNSAFE');
    expect(() =>
      validateTerraformPlan('dev-inverse', {
        resource_changes: [change('google_pubsub_topic.message_digest_runs', ['create'])],
      })
    ).toThrow('CUTOVER_TERRAFORM_PLAN_UNSAFE');
    expect(() =>
      validateTerraformPlan('dev-inverse', {
        resource_changes: [
          change('google_pubsub_topic.message_digest_runs', ['delete']),
          change('google_pubsub_topic.message_digest_runs', ['delete']),
        ],
      })
    ).toThrow('CUTOVER_TERRAFORM_PLAN_UNSAFE');

    const completeDevInverse = [
      change('google_pubsub_topic.message_digest_runs', ['delete']),
      change('google_pubsub_topic_iam_member.message_digest_publishes_runs', ['delete']),
      change('google_pubsub_topic_iam_member.message_digest_publishes_whatsapp', ['delete']),
    ];
    const completeProdInverse = [
      change('google_pubsub_topic.hetzner_push_dlq["message_digest_runs"]', ['delete']),
      change('google_pubsub_subscription.hetzner_push_dlq_inspect["message_digest_runs"]', [
        'delete',
      ]),
      change('google_pubsub_topic_iam_member.hetzner_push_dlq_publisher["message_digest_runs"]', [
        'delete',
      ]),
      change('google_pubsub_subscription.hetzner_push["message_digest_runs"]', ['delete']),
      change(
        'google_pubsub_subscription_iam_member.hetzner_push_dlq_subscriber["message_digest_runs"]',
        ['delete']
      ),
      change('google_cloud_scheduler_job.hetzner_http["message_digest_tick"]', ['delete']),
      change('google_cloud_scheduler_job.hetzner_http["mobile_notifications_digest_yesterday"]', [
        'create',
      ]),
    ];

    expect(
      validateTerraformPlan('dev-inverse-complete', {
        resource_changes: completeDevInverse,
      })
    ).toHaveLength(3);
    expect(
      validateTerraformPlan('prod-inverse-complete', {
        resource_changes: completeProdInverse,
      })
    ).toHaveLength(7);
    expect(() =>
      validateTerraformPlan('dev-inverse-complete', {
        resource_changes: [completeDevInverse[0]],
      })
    ).toThrow('CUTOVER_TERRAFORM_PLAN_UNSAFE');
  });

  it('limits every saved Terraform plan to the reviewed Message Digest resources', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-terraform-targets-'));
    const tracePath = resolve(directory, 'terraform-plan-trace.txt');
    const devTargets = [
      '-target=google_pubsub_topic.message_digest_runs',
      '-target=google_pubsub_topic_iam_member.message_digest_publishes_runs',
      '-target=google_pubsub_topic_iam_member.message_digest_publishes_whatsapp',
    ];
    const prodTargets = [
      '-target=google_pubsub_topic.hetzner_push_dlq["message_digest_runs"]',
      '-target=google_pubsub_subscription.hetzner_push_dlq_inspect["message_digest_runs"]',
      '-target=google_pubsub_topic_iam_member.hetzner_push_dlq_publisher["message_digest_runs"]',
      '-target=google_pubsub_subscription.hetzner_push["message_digest_runs"]',
      '-target=google_pubsub_subscription_iam_member.hetzner_push_dlq_subscriber["message_digest_runs"]',
      '-target=google_cloud_scheduler_job.hetzner_http["message_digest_tick"]',
      '-target=google_cloud_scheduler_job.hetzner_http["mobile_notifications_digest_yesterday"]',
    ];

    try {
      const result = runShellLibrary(
        cutoverPath,
        `
TRACE_FILE="$TEST_TRACE_FILE"
terraform_environment() {
  local argument=""
  local operation=""
  for argument in "$@"; do
    case "$argument" in
      plan) operation="plan" ;;
      show) operation="show" ;;
    esac
  done
  if [[ "$operation" == "plan" ]]; then
    {
      printf 'PLAN'
      printf '\t%s' "$@"
      printf '\n'
    } >> "$TRACE_FILE"
  elif [[ "$operation" == "show" ]]; then
    printf '{"resource_changes":[]}\n'
  fi
}
validate_terraform_plan() { :; }
ATTEMPT_DIR="$TEST_ATTEMPT_DIR"
TERRAFORM_DATA_ROOT="$ATTEMPT_DIR/terraform-data"
TERRAFORM_PLAN_ROOT="$ATTEMPT_DIR/terraform-plans"
mkdir -p "$TERRAFORM_DATA_ROOT" "$TERRAFORM_PLAN_ROOT"
forward_terraform_dev
forward_terraform_prod
verify_inverse_terraform_plans
rollback_terraform_prod
rollback_terraform_dev
cat "$TRACE_FILE"
`,
        {
          RELEASE_DIR: repoRoot,
          PREVIOUS_RELEASE_DIR: repoRoot,
          TEST_ATTEMPT_DIR: directory,
          TEST_TRACE_FILE: tracePath,
        }
      );

      expect(result.status, result.stderr).toBe(0);
      const planCalls = result.stdout
        .trim()
        .split('\n')
        .map((line) => line.split('\t').slice(1));
      expect(planCalls).toHaveLength(6);
      expect(
        planCalls.map((call) => call.filter((argument) => argument.startsWith('-target=')))
      ).toEqual([devTargets, prodTargets, prodTargets, devTargets, prodTargets, devTargets]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not mark a Terraform mutation before the forward plan passes validation', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-terraform-pre-plan-'));
    try {
      const result = runShellLibrary(
        cutoverPath,
        `
terraform_environment() { return 42; }
ATTEMPT_DIR="$TEST_ATTEMPT_DIR"
TERRAFORM_DATA_ROOT="$ATTEMPT_DIR/terraform-data"
TERRAFORM_PLAN_ROOT="$ATTEMPT_DIR/terraform-plans"
mkdir -p "$TERRAFORM_DATA_ROOT" "$TERRAFORM_PLAN_ROOT"
forward_terraform_dev
`,
        {
          RELEASE_DIR: repoRoot,
          TEST_ATTEMPT_DIR: directory,
        }
      );

      expect(result.status).not.toBe(0);
      expect(existsSync(resolve(directory, 'terraform-dev-forward.started'))).toBe(false);
      expect(existsSync(resolve(directory, 'terraform-dev-forward.apply-started'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records Terraform apply intent after validation and before invoking apply', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-terraform-apply-intent-'));
    const tracePath = resolve(directory, 'trace.txt');
    try {
      const result = runShellLibrary(
        cutoverPath,
        `
TRACE_FILE="$TEST_TRACE_FILE"
terraform_environment() {
  local argument=""
  local operation=""
  for argument in "$@"; do
    case "$argument" in
      init|plan|show|apply) operation="$argument" ;;
    esac
  done
  printf '%s\n' "$operation" >> "$TRACE_FILE"
  if [[ "$operation" == "show" ]]; then
    printf '{"resource_changes":[]}\n'
  elif [[ "$operation" == "apply" ]]; then
    return 42
  fi
}
validate_terraform_plan() { printf 'validated\n' >> "$TRACE_FILE"; }
ATTEMPT_DIR="$TEST_ATTEMPT_DIR"
TERRAFORM_DATA_ROOT="$ATTEMPT_DIR/terraform-data"
TERRAFORM_PLAN_ROOT="$ATTEMPT_DIR/terraform-plans"
mkdir -p "$TERRAFORM_DATA_ROOT" "$TERRAFORM_PLAN_ROOT"
forward_terraform_dev
`,
        {
          RELEASE_DIR: repoRoot,
          TEST_ATTEMPT_DIR: directory,
          TEST_TRACE_FILE: tracePath,
        }
      );

      expect(result.status).not.toBe(0);
      expect(readFileSync(tracePath, 'utf8').trim().split('\n')).toEqual([
        'init',
        'plan',
        'show',
        'validated',
        'apply',
      ]);
      expect(existsSync(resolve(directory, 'terraform-dev-forward.started'))).toBe(false);
      expect(existsSync(resolve(directory, 'terraform-dev-forward.apply-started'))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists Terraform apply intent durably before remote mutation begins', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-durable-marker-'));
    const markerPath = resolve(directory, 'terraform-dev-forward.apply-started');
    try {
      const result = runShellLibrary(cutoverPath, 'write_durable_marker "$TEST_MARKER_PATH"', {
        TEST_MARKER_PATH: markerPath,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(markerPath, 'utf8')).toBe('apply-started\n');
      expect(statSync(markerPath).mode & 0o777).toBe(0o600);

      const cutover = readFileSync(cutoverPath, 'utf8');
      const writer = cutover.slice(
        cutover.indexOf('write_durable_marker() {'),
        cutover.indexOf('\n}\n\nplan_and_apply_terraform()')
      );
      expect(writer).toContain('fsyncSync(markerDescriptor)');
      expect(writer).toContain('renameSync(temporaryPath, markerPath)');
      expect(writer).toContain('fsyncSync(directoryDescriptor)');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('runs inverse Terraform only when a forward apply could have mutated state', () => {
    const invokeRollback = (marker: string): string[] => {
      const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-terraform-rollback-'));
      const attemptDirectory = resolve(directory, 'attempt');
      const tracePath = resolve(directory, 'trace.txt');
      const statePath = resolve(directory, 'state.json');
      mkdirSync(attemptDirectory);
      writeFileSync(resolve(attemptDirectory, marker), '', 'utf8');
      writeFileSync(statePath, '{}\n', 'utf8');
      try {
        const result = runShellLibrary(
          cutoverPath,
          `
TRACE_FILE="$TEST_TRACE_FILE"
ATTEMPT_DIR="$TEST_ATTEMPT_DIR"
STATE_PATH="$TEST_STATE_PATH"
CUTOVER_ADMITTED="false"
ROLLBACK_RUNNING="false"
MERGE_SHA="${'a'.repeat(40)}"
DEPLOYMENT_ID="deployment-123"
node() { :; }
state_completed_count() { printf '5'; }
hold_affected_ingress_fail_closed() { printf 'hold\n' >> "$TRACE_FILE"; }
restore_previous_runtime() { printf 'runtime\n' >> "$TRACE_FILE"; }
rollback_terraform_prod() { printf 'prod-inverse\n' >> "$TRACE_FILE"; }
rollback_terraform_dev() { printf 'dev-inverse\n' >> "$TRACE_FILE"; }
restore_previous_ingress() { printf 'ingress\n' >> "$TRACE_FILE"; }
rollback_pre_admission
cat "$TRACE_FILE"
`,
          {
            TEST_ATTEMPT_DIR: attemptDirectory,
            TEST_STATE_PATH: statePath,
            TEST_TRACE_FILE: tracePath,
          }
        );

        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim().split('\n');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    };

    expect(invokeRollback('terraform-dev-forward.started')).toEqual(['hold', 'runtime', 'ingress']);
    expect(invokeRollback('terraform-dev-forward.apply-started')).toEqual([
      'hold',
      'runtime',
      'dev-inverse',
      'ingress',
    ]);
  });

  it('does not apply an inverse plan after planning fails inside rollback error handling', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-terraform-fail-fast-'));
    const tracePath = resolve(directory, 'trace.txt');
    try {
      const result = runShellLibrary(
        cutoverPath,
        `
TRACE_FILE="$TEST_TRACE_FILE"
plan_terraform() { printf 'plan\n' >> "$TRACE_FILE"; return 42; }
terraform_environment() { printf 'apply\n' >> "$TRACE_FILE"; }
PREVIOUS_RELEASE_DIR="$TEST_PREVIOUS_RELEASE_DIR"
TERRAFORM_DATA_ROOT="$TEST_ATTEMPT_DIR/terraform-data"
TERRAFORM_PLAN_ROOT="$TEST_ATTEMPT_DIR/terraform-plans"
if rollback_terraform_dev; then
  printf 'rollback-success\n' >> "$TRACE_FILE"
else
  printf 'rollback-failed\n' >> "$TRACE_FILE"
fi
cat "$TRACE_FILE"
`,
        {
          TEST_ATTEMPT_DIR: directory,
          TEST_PREVIOUS_RELEASE_DIR: repoRoot,
          TEST_TRACE_FILE: tracePath,
        }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual(['plan', 'rollback-failed']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reviews complete inverse plans from the previous release after both forward applies', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-inverse-proof-'));
    const tracePath = resolve(directory, 'terraform-trace.txt');
    const fixtureDirectory = resolve(directory, 'fixtures');
    const currentRelease = resolve(directory, 'current-release');
    const previousRelease = resolve(directory, 'previous-release');
    const devAddresses = [
      'google_pubsub_topic.message_digest_runs',
      'google_pubsub_topic_iam_member.message_digest_publishes_runs',
      'google_pubsub_topic_iam_member.message_digest_publishes_whatsapp',
    ];
    const prodAddresses = [
      'google_pubsub_topic.hetzner_push_dlq["message_digest_runs"]',
      'google_pubsub_subscription.hetzner_push_dlq_inspect["message_digest_runs"]',
      'google_pubsub_topic_iam_member.hetzner_push_dlq_publisher["message_digest_runs"]',
      'google_pubsub_subscription.hetzner_push["message_digest_runs"]',
      'google_pubsub_subscription_iam_member.hetzner_push_dlq_subscriber["message_digest_runs"]',
      'google_cloud_scheduler_job.hetzner_http["message_digest_tick"]',
      'google_cloud_scheduler_job.hetzner_http["mobile_notifications_digest_yesterday"]',
    ];

    mkdirSync(fixtureDirectory, { recursive: true });
    for (const root of [currentRelease, previousRelease]) {
      mkdirSync(resolve(root, 'terraform/environments/dev'), { recursive: true });
      mkdirSync(resolve(root, 'terraform/hetzner-prod'), { recursive: true });
    }
    writeFileSync(
      resolve(fixtureDirectory, 'dev-forward.json'),
      JSON.stringify({
        resource_changes: devAddresses.map((address) => change(address, ['create'])),
      })
    );
    writeFileSync(
      resolve(fixtureDirectory, 'prod-forward.json'),
      JSON.stringify({
        resource_changes: prodAddresses.map((address, index) =>
          change(address, [index === prodAddresses.length - 1 ? 'delete' : 'create'])
        ),
      })
    );
    writeFileSync(
      resolve(fixtureDirectory, 'dev-inverse-proof.json'),
      JSON.stringify({
        resource_changes: devAddresses.map((address) => change(address, ['delete'])),
      })
    );
    writeFileSync(
      resolve(fixtureDirectory, 'prod-inverse-proof.json'),
      JSON.stringify({
        resource_changes: prodAddresses.map((address, index) =>
          change(address, [index === prodAddresses.length - 1 ? 'create' : 'delete'])
        ),
      })
    );

    try {
      const result = runShellLibrary(
        cutoverPath,
        `
TRACE_FILE="$TEST_TRACE_FILE"
SUPPORT_HELPER="$TEST_SUPPORT_HELPER"
terraform_environment() {
  local argument=""
  local operation=""
  local plan_file=""
  local root=""
  for argument in "$@"; do
    case "$argument" in
      -chdir=*) root="\${argument#-chdir=}" ;;
      plan|show|apply) operation="$argument" ;;
      -out=*) plan_file="\${argument#-out=}" ;;
      *.tfplan) plan_file="$argument" ;;
    esac
  done
  case "$operation" in
    plan)
      printf 'PLAN\\t%s\\t%s\\n' "$root" "$plan_file" >> "$TRACE_FILE"
      ;;
    show)
      case "$plan_file" in
        *dev-forward.tfplan) command cat "$TEST_FIXTURE_DIR/dev-forward.json" ;;
        *prod-forward.tfplan) command cat "$TEST_FIXTURE_DIR/prod-forward.json" ;;
        *dev-inverse-proof.tfplan) command cat "$TEST_FIXTURE_DIR/dev-inverse-proof.json" ;;
        *prod-inverse-proof.tfplan) command cat "$TEST_FIXTURE_DIR/prod-inverse-proof.json" ;;
        *) return 97 ;;
      esac
      ;;
    apply)
      printf 'APPLY\\t%s\\t%s\\n' "$root" "$plan_file" >> "$TRACE_FILE"
      ;;
  esac
}
ATTEMPT_DIR="$TEST_ATTEMPT_DIR"
TERRAFORM_DATA_ROOT="$ATTEMPT_DIR/terraform-data"
TERRAFORM_PLAN_ROOT="$ATTEMPT_DIR/terraform-plans"
mkdir -p "$TERRAFORM_DATA_ROOT" "$TERRAFORM_PLAN_ROOT"
forward_terraform_dev
forward_terraform_prod
verify_inverse_terraform_plans
command cat "$TRACE_FILE"
`,
        {
          RELEASE_DIR: currentRelease,
          PREVIOUS_RELEASE_DIR: previousRelease,
          TEST_ATTEMPT_DIR: directory,
          TEST_FIXTURE_DIR: fixtureDirectory,
          TEST_SUPPORT_HELPER: resolve(
            repoRoot,
            'scripts/hetzner/message-digest-cutover-support.mjs'
          ),
          TEST_TRACE_FILE: tracePath,
        }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        `PLAN\t${currentRelease}/terraform/environments/dev\t${directory}/terraform-plans/dev-forward.tfplan`,
        `APPLY\t${currentRelease}/terraform/environments/dev\t${directory}/terraform-plans/dev-forward.tfplan`,
        `PLAN\t${currentRelease}/terraform/hetzner-prod\t${directory}/terraform-plans/prod-forward.tfplan`,
        `APPLY\t${currentRelease}/terraform/hetzner-prod\t${directory}/terraform-plans/prod-forward.tfplan`,
        `PLAN\t${previousRelease}/terraform/hetzner-prod\t${directory}/terraform-plans/prod-inverse-proof.tfplan`,
        `PLAN\t${previousRelease}/terraform/environments/dev\t${directory}/terraform-plans/dev-inverse-proof.tfplan`,
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('isolates the Message Digest WhatsApp publisher from broad module IAM dependencies', () => {
    const terraform = readFileSync(resolve(repoRoot, 'terraform/environments/dev/main.tf'), 'utf8');
    const iamModule = readFileSync(resolve(repoRoot, 'terraform/modules/iam/main.tf'), 'utf8');
    const iamOutputs = readFileSync(resolve(repoRoot, 'terraform/modules/iam/outputs.tf'), 'utf8');
    const moduleStart = terraform.indexOf('module "pubsub_whatsapp_send" {');
    const moduleEnd = terraform.indexOf('\n}\n', moduleStart) + 3;
    const whatsappModule = terraform.slice(moduleStart, moduleEnd);
    const publisherStart = terraform.indexOf(
      'resource "google_pubsub_topic_iam_member" "message_digest_publishes_whatsapp" {'
    );
    const publisherEnd = terraform.indexOf('\n}\n', publisherStart) + 3;
    const publisher = terraform.slice(publisherStart, publisherEnd);

    expect(moduleStart).toBeGreaterThanOrEqual(0);
    expect(moduleEnd).toBeGreaterThan(moduleStart);
    expect(whatsappModule).not.toContain('message_digest_service');
    expect(terraform).toContain('resource "google_service_account" "message_digest_service" {');
    expect(iamModule).not.toContain('resource "google_service_account" "message_digest_service"');
    expect(iamOutputs).not.toContain('message_digest_service');
    expect(terraform).toContain(
      'resource "google_pubsub_topic_iam_member" "message_digest_publishes_whatsapp" {'
    );
    expect(publisher).toContain('topic   = "intexuraos-whatsapp-send-${var.environment}"');
    expect(publisher).toContain(
      'member  = "serviceAccount:${google_service_account.message_digest_service.email}"'
    );
    expect(publisher).not.toContain('module.');

    const cutover = readFileSync(cutoverPath, 'utf8');
    const support = readFileSync(
      resolve(repoRoot, 'scripts/hetzner/message-digest-cutover-support.mjs'),
      'utf8'
    );
    expect(cutover).not.toContain('google_service_account.message_digest_service');
    expect(support).not.toContain('google_service_account.message_digest_service');
    for (const source of [cutover, support]) {
      expect(source).not.toContain('module.iam.google_service_account.message_digest_service');
      expect(source).toContain('google_pubsub_topic_iam_member.message_digest_publishes_whatsapp');
      expect(source).not.toContain(
        'module.pubsub_whatsapp_send.google_pubsub_topic_iam_member.publisher["message_digest_service"]'
      );
    }
  });

  it('persists one resumable lease and monotonic checkpoints outside the runner', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-cutover-state-'));
    const statePath = resolve(directory, 'state.json');
    const metadata = {
      migrationId: `mdm_${'c'.repeat(40)}`,
      mergeSha: 'c'.repeat(40),
      testedTree: 'a'.repeat(40),
      deploymentId: 'workflow-123',
      releaseDir: '/opt/intexuraos/releases/candidate',
      previousReleaseDir: '/opt/intexuraos/releases/previous',
      cutoverStart: '2026-07-29T01:05:00.000Z',
      cutoverDeadline: '2026-07-29T03:05:00.000Z',
      now: '2026-07-29T01:05:00.000Z',
    };
    try {
      const acquired = acquireCutoverLease({ statePath, ...metadata });
      expect(acquired.completedSteps).toEqual([]);
      expect(acquired).toMatchObject({ attempt: 1, attemptHistory: [] });
      expect(acquireCutoverLease({ statePath, ...metadata })).toEqual(
        expect.objectContaining({ migrationId: metadata.migrationId, completedSteps: [] })
      );
      expect(
        acquireCutoverLease({
          statePath,
          ...metadata,
          cutoverStart: '2026-07-29T01:15:00.000Z',
          cutoverDeadline: '2026-07-29T03:15:00.000Z',
          now: '2026-07-29T01:15:00.000Z',
        })
      ).toEqual(
        expect.objectContaining({
          cutoverStart: metadata.cutoverStart,
          cutoverDeadline: metadata.cutoverDeadline,
        })
      );
      expect(() =>
        acquireCutoverLease({
          statePath,
          ...metadata,
          migrationId: `mdm_${'d'.repeat(40)}`,
          mergeSha: 'd'.repeat(40),
        })
      ).toThrow('CUTOVER_DEPLOYMENT_LEASE_HELD');

      completeCutoverCheckpoint({
        statePath,
        migrationId: metadata.migrationId,
        deploymentId: metadata.deploymentId,
        step: 'verify-tested-release',
        now: '2026-07-29T01:06:00.000Z',
      });
      expect(readCutoverCliSummary(statePath).completedStepCount).toBe(1);
      expect(() =>
        completeCutoverCheckpoint({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          step: 'start-candidate-stack',
          now: '2026-07-29T01:07:00.000Z',
        })
      ).toThrow('CUTOVER_CHECKPOINT_OUT_OF_ORDER');

      completeCutoverCheckpoint({
        statePath,
        migrationId: metadata.migrationId,
        deploymentId: metadata.deploymentId,
        step: 'assert-pending-migration-128',
        now: '2026-07-29T01:07:30.000Z',
      });
      expect(readCutoverCliSummary(statePath).completedStepCount).toBe(2);
      expect(acquireCutoverLease({ statePath, ...metadata }).completedSteps).toHaveLength(2);
      expect(readCutoverCliSummary(statePath).completedStepCount).toBe(2);

      for (const step of [
        'start-candidate-stack',
        'migration-dry-run',
        'estimate-window',
        'terraform-dev-forward',
        'migration-128',
        'wait-index-readiness',
        'terraform-prod-forward',
        'terraform-inverse-proof',
        'migration-apply',
        'migration-verify',
        'candidate-zero-send-proof',
        'switch-runtime-under-hold',
        'migration-activate',
      ]) {
        completeCutoverCheckpoint({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          step,
          now: '2026-07-29T01:08:00.000Z',
        });
      }
      expect(() => assertPreAdmissionCompensationAllowed(statePath)).not.toThrow();
      expect(() =>
        completeCutoverCheckpoint({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          step: 'public-admission',
          now: '2026-07-29T01:08:30.000Z',
        })
      ).toThrow('CUTOVER_CHECKPOINT_FORBIDDEN');
      const admitting = beginPublicAdmission({
        statePath,
        migrationId: metadata.migrationId,
        deploymentId: metadata.deploymentId,
        now: '2026-07-29T01:08:45.000Z',
      });
      expect(admitting).toMatchObject({
        status: 'admitting',
        admitted: false,
        admittingAt: '2026-07-29T01:08:45.000Z',
        admittedAt: null,
      });
      expect(
        beginPublicAdmission({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          now: '2026-07-29T01:08:50.000Z',
        })
      ).toMatchObject({ status: 'admitting', admittingAt: admitting.admittingAt });
      completeCutoverCheckpoint({
        statePath,
        migrationId: metadata.migrationId,
        deploymentId: metadata.deploymentId,
        step: 'public-admission',
        now: '2026-07-29T01:09:00.000Z',
      });
      expect(() => assertPreAdmissionCompensationAllowed(statePath)).toThrow(
        'CUTOVER_COMPENSATION_FORBIDDEN_AFTER_ADMISSION'
      );
      completeCutoverCheckpoint({
        statePath,
        migrationId: metadata.migrationId,
        deploymentId: metadata.deploymentId,
        step: 'post-admission-verify',
        now: '2026-07-29T01:10:00.000Z',
      });
      markCutoverComplete({
        statePath,
        migrationId: metadata.migrationId,
        deploymentId: metadata.deploymentId,
        now: '2026-07-29T01:11:00.000Z',
      });
      expect(readCutoverState(statePath)).toEqual(
        expect.objectContaining({ status: 'complete', admitted: true })
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('makes durable admission intent forward-only before any public checkpoint', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-cutover-admitting-'));
    const statePath = resolve(directory, 'state.json');
    const metadata = {
      migrationId: `mdm_${'c'.repeat(40)}`,
      mergeSha: 'c'.repeat(40),
      testedTree: 'a'.repeat(40),
      deploymentId: 'workflow-123',
      releaseDir: '/opt/intexuraos/releases/candidate',
      previousReleaseDir: '/opt/intexuraos/releases/previous',
      cutoverStart: '2026-07-29T01:05:00.000Z',
      cutoverDeadline: '2026-07-29T03:05:00.000Z',
      now: '2026-07-29T01:05:00.000Z',
    };
    try {
      acquireCutoverLease({ statePath, ...metadata });
      expect(() =>
        beginPublicAdmission({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          now: '2026-07-29T01:05:30.000Z',
        })
      ).toThrow('CUTOVER_ADMISSION_FORBIDDEN');
      for (const [index, step] of MESSAGE_DIGEST_CUTOVER_STEPS.slice(0, 15).entries()) {
        completeCutoverCheckpoint({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          step,
          now: new Date(Date.parse(metadata.now) + (index + 1) * 1_000).toISOString(),
        });
      }

      beginPublicAdmission({
        statePath,
        migrationId: metadata.migrationId,
        deploymentId: metadata.deploymentId,
        now: '2026-07-29T01:06:00.000Z',
      });
      expect(() => assertPreAdmissionCompensationAllowed(statePath)).toThrow(
        'CUTOVER_COMPENSATION_FORBIDDEN_AFTER_ADMISSION'
      );
      expect(() =>
        beginCutoverCompensation({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          now: '2026-07-29T01:06:01.000Z',
        })
      ).toThrow('CUTOVER_COMPENSATION_FORBIDDEN_AFTER_ADMISSION');
      expect(() =>
        markCutoverCompensated({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          now: '2026-07-29T01:06:02.000Z',
        })
      ).toThrow('CUTOVER_COMPENSATION_FORBIDDEN_AFTER_ADMISSION');
      expect(() =>
        markCutoverComplete({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          now: '2026-07-29T01:06:03.000Z',
        })
      ).toThrow('CUTOVER_COMPLETION_FORBIDDEN');
      expect(acquireCutoverLease({ statePath, ...metadata })).toMatchObject({
        status: 'admitting',
        completedSteps: MESSAGE_DIGEST_CUTOVER_STEPS.slice(0, 15),
      });
      expect(() =>
        acquireCutoverLease({
          statePath,
          ...metadata,
          deploymentId: 'workflow-456',
        })
      ).toThrow('CUTOVER_DEPLOYMENT_LEASE_HELD');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records complete compensation and permits a fresh identical release attempt', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-cutover-retry-'));
    const statePath = resolve(directory, 'state.json');
    const metadata = {
      migrationId: `mdm_${'c'.repeat(40)}`,
      mergeSha: 'c'.repeat(40),
      testedTree: 'a'.repeat(40),
      deploymentId: 'workflow-123',
      releaseDir: '/opt/intexuraos/releases/candidate',
      previousReleaseDir: '/opt/intexuraos/releases/previous',
      cutoverStart: '2026-07-29T01:05:00.000Z',
      cutoverDeadline: '2026-07-29T03:05:00.000Z',
      now: '2026-07-29T01:05:00.000Z',
    };
    try {
      acquireCutoverLease({ statePath, ...metadata });
      completeCutoverCheckpoint({
        statePath,
        migrationId: metadata.migrationId,
        deploymentId: metadata.deploymentId,
        step: 'verify-tested-release',
        now: '2026-07-29T01:06:00.000Z',
      });

      expect(
        beginCutoverCompensation({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          now: '2026-07-29T01:07:00.000Z',
        })
      ).toMatchObject({ status: 'compensating', admitted: false });
      expect(() =>
        completeCutoverCheckpoint({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          step: 'assert-pending-migration-128',
          now: '2026-07-29T01:08:00.000Z',
        })
      ).toThrow('CUTOVER_CHECKPOINT_FORBIDDEN');
      expect(() =>
        acquireCutoverLease({
          statePath,
          ...metadata,
          deploymentId: 'workflow-456',
          now: '2026-07-29T01:08:00.000Z',
        })
      ).toThrow('CUTOVER_DEPLOYMENT_LEASE_HELD');

      expect(
        markCutoverCompensated({
          statePath,
          migrationId: metadata.migrationId,
          deploymentId: metadata.deploymentId,
          now: '2026-07-29T01:09:00.000Z',
        })
      ).toMatchObject({ status: 'compensated', compensatedAt: '2026-07-29T01:09:00.000Z' });
      expect(() =>
        acquireCutoverLease({
          statePath,
          ...metadata,
          deploymentId: 'workflow-456',
          releaseDir: '/opt/intexuraos/releases/different',
          cutoverStart: '2026-07-29T04:00:00.000Z',
          cutoverDeadline: '2026-07-29T06:00:00.000Z',
          now: '2026-07-29T04:00:00.000Z',
        })
      ).toThrow('CUTOVER_DEPLOYMENT_LEASE_HELD');

      const retried = acquireCutoverLease({
        statePath,
        ...metadata,
        deploymentId: 'workflow-456',
        cutoverStart: '2026-07-29T04:00:00.000Z',
        cutoverDeadline: '2026-07-29T06:00:00.000Z',
        now: '2026-07-29T04:00:00.000Z',
      });
      expect(retried).toMatchObject({
        status: 'in_progress',
        attempt: 2,
        deploymentId: 'workflow-456',
        cutoverStart: '2026-07-29T04:00:00.000Z',
        cutoverDeadline: '2026-07-29T06:00:00.000Z',
        admitted: false,
        admittedAt: null,
        compensatedAt: null,
        completedSteps: [],
        attemptHistory: [
          {
            attempt: 1,
            deploymentId: 'workflow-123',
            completedSteps: ['verify-tested-release'],
            compensatedAt: '2026-07-29T01:09:00.000Z',
          },
        ],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('admits a corrected immutable release only after complete compensation', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-cutover-corrected-release-'));
    const statePath = resolve(directory, 'state.json');
    const original = {
      migrationId: `mdm_${'c'.repeat(40)}`,
      mergeSha: 'c'.repeat(40),
      testedTree: 'a'.repeat(40),
      deploymentId: 'workflow-123',
      releaseDir: `/opt/intexuraos/releases/${'c'.repeat(40)}`,
      previousReleaseDir: `/opt/intexuraos/releases/${'b'.repeat(40)}`,
      cutoverStart: '2026-07-29T01:05:00.000Z',
      cutoverDeadline: '2026-07-29T03:05:00.000Z',
      now: '2026-07-29T01:05:00.000Z',
    };
    const corrected = {
      ...original,
      migrationId: `mdm_${'d'.repeat(40)}`,
      mergeSha: 'd'.repeat(40),
      testedTree: 'e'.repeat(40),
      deploymentId: 'workflow-456',
      releaseDir: `/opt/intexuraos/releases/${'d'.repeat(40)}`,
      cutoverStart: '2026-07-29T04:00:00.000Z',
      cutoverDeadline: '2026-07-29T06:00:00.000Z',
      now: '2026-07-29T04:00:00.000Z',
    };

    try {
      acquireCutoverLease({ statePath, ...original });
      completeCutoverCheckpoint({
        statePath,
        migrationId: original.migrationId,
        deploymentId: original.deploymentId,
        step: 'verify-tested-release',
        now: '2026-07-29T01:06:00.000Z',
      });

      expect(() => acquireCutoverLease({ statePath, ...corrected })).toThrow(
        'CUTOVER_DEPLOYMENT_LEASE_HELD'
      );
      beginCutoverCompensation({
        statePath,
        migrationId: original.migrationId,
        deploymentId: original.deploymentId,
        now: '2026-07-29T01:07:00.000Z',
      });
      markCutoverCompensated({
        statePath,
        migrationId: original.migrationId,
        deploymentId: original.deploymentId,
        now: '2026-07-29T01:08:00.000Z',
      });

      expect(() =>
        acquireCutoverLease({
          statePath,
          ...corrected,
          previousReleaseDir: `/opt/intexuraos/releases/${'f'.repeat(40)}`,
        })
      ).toThrow('CUTOVER_DEPLOYMENT_LEASE_HELD');
      expect(() =>
        acquireCutoverLease({
          statePath,
          ...corrected,
          migrationId: original.migrationId,
        })
      ).toThrow('CUTOVER_DEPLOYMENT_LEASE_HELD');
      expect(() =>
        acquireCutoverLease({
          statePath,
          ...corrected,
          releaseDir: `/opt/intexuraos/releases/${'f'.repeat(40)}`,
        })
      ).toThrow('CUTOVER_DEPLOYMENT_LEASE_HELD');

      const retried = acquireCutoverLease({ statePath, ...corrected });
      expect(retried).toMatchObject({
        migrationId: corrected.migrationId,
        mergeSha: corrected.mergeSha,
        testedTree: corrected.testedTree,
        releaseDir: corrected.releaseDir,
        previousReleaseDir: original.previousReleaseDir,
        deploymentId: corrected.deploymentId,
        status: 'in_progress',
        attempt: 2,
        completedSteps: [],
        attemptHistory: [
          {
            attempt: 1,
            migrationId: original.migrationId,
            mergeSha: original.mergeSha,
            testedTree: original.testedTree,
            deploymentId: original.deploymentId,
            releaseDir: original.releaseDir,
            previousReleaseDir: original.previousReleaseDir,
            completedSteps: ['verify-tested-release'],
            compensatedAt: '2026-07-29T01:08:00.000Z',
          },
        ],
      });
      expect(() =>
        completeCutoverCheckpoint({
          statePath,
          migrationId: original.migrationId,
          deploymentId: corrected.deploymentId,
          step: 'verify-tested-release',
          now: '2026-07-29T04:01:00.000Z',
        })
      ).toThrow('CUTOVER_DEPLOYMENT_LEASE_HELD');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses to expose an arithmetic checkpoint count from malformed durable state', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-cutover-invalid-state-'));
    const statePath = resolve(directory, 'state.json');
    try {
      writeFileSync(statePath, '{"completedSteps":["verify-tested-release"]}\n', 'utf8');
      expectInvalidCutoverCliState(statePath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('Message Digest candidate stack and cutover script', () => {
  it('keeps silent Hetzner cutover SSH sessions alive and fails dead transports promptly', () => {
    const deploy = readFileSync(deployPath, 'utf8');
    const sshCommand = deploy.slice(
      deploy.indexOf('ssh_command_string() {'),
      deploy.indexOf('\n}\n\nprepare_remote_terraform()')
    );
    const remoteCommand = deploy.slice(
      deploy.indexOf('run_remote_at() {'),
      deploy.indexOf('\n}\n\nrun_remote()')
    );

    for (const block of [sshCommand, remoteCommand]) {
      expect(block).toContain('ServerAliveInterval=15');
      expect(block).toContain('ServerAliveCountMax=8');
    }
  });

  it('restarts hidden candidate services only when resuming a pre-activation checkpoint', () => {
    const invoke = (completedStepCount: number): ReturnType<typeof spawnSync> =>
      runShellLibrary(
        cutoverPath,
        `
state_completed_count() { printf '%s' "$TEST_COMPLETED_STEP_COUNT"; }
start_candidate_compensation_stack() { printf 'restart-candidate\\n'; }
restart_candidate_stack_for_resumed_pre_activation
`,
        { TEST_COMPLETED_STEP_COUNT: String(completedStepCount) }
      );

    for (const completedStepCount of [0, 1, 2, 14, 15, 16, 17]) {
      const freshOrSwitched = invoke(completedStepCount);
      expect(freshOrSwitched.status, freshOrSwitched.stderr).toBe(0);
      expect(freshOrSwitched.stdout).toBe('');
    }
    for (const completedStepCount of [3, 11, 12, 13]) {
      const resumedCandidate = invoke(completedStepCount);
      expect(resumedCandidate.status, resumedCandidate.stderr).toBe(0);
      expect(resumedCandidate.stdout).toBe('restart-candidate\n');
    }

    const cutover = readFileSync(cutoverPath, 'utf8');
    const main = cutover.slice(cutover.indexOf('main() {'));
    expect(main.indexOf('acquire_durable_lease')).toBeLessThan(
      main.indexOf('restart_candidate_stack_for_resumed_pre_activation')
    );
    expect(main.indexOf('restart_candidate_stack_for_resumed_pre_activation')).toBeLessThan(
      main.indexOf('run_step "verify-tested-release"')
    );
  });

  it('stages one pinned and hash-verified Terraform runtime outside the immutable release', () => {
    const deploy = readFileSync(deployPath, 'utf8');
    const main = deploy.slice(deploy.indexOf('main() {'));

    expect(deploy).toContain('TERRAFORM_VERSION="1.5.0"');
    expect(deploy).toContain(
      'TERRAFORM_ARCHIVE_SHA256="9ae1bcfef088e9aaabeaf6fdc6cce01187dc4936f1564899ee6fa6baec5ad19c"'
    );
    expect(deploy).toContain(
      'https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip'
    );
    expect(deploy).toContain('REMOTE_TERRAFORM_TOOLS_DIR=');
    expect(deploy).toContain('/.deployment-tools/terraform/${TERRAFORM_VERSION}');
    expect(deploy).toContain('verify_sha256');
    expect(deploy).toContain('observed_hash');
    expect(deploy).toContain('terraform version -json');
    expect(deploy).toContain("--exclude '/.deployment-tools/'");
    expect(deploy).not.toContain('/usr/local/bin/terraform');
    expect(main.indexOf('prepare_remote_terraform')).toBeGreaterThan(-1);
    expect(main.indexOf('prepare_remote_terraform')).toBeLessThan(
      main.indexOf('run_message_digest_cutover')
    );
  });

  it('fails before extracting or staging Terraform when archive verification fails', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-terraform-runtime-'));
    const tracePath = resolve(directory, 'trace.txt');
    try {
      const result = runShellLibrary(
        deployPath,
        `
curl() { printf 'curl\\n' >> "$TEST_TRACE_PATH"; }
sha256_file() { printf 'unexpected-hash'; }
unzip() { printf 'unzip\\n' >> "$TEST_TRACE_PATH"; }
rsync() { printf 'rsync\\n' >> "$TEST_TRACE_PATH"; }
run_remote_at() { printf 'remote\\n' >> "$TEST_TRACE_PATH"; }
prepare_remote_terraform
`,
        {
          TEST_TRACE_PATH: tracePath,
          TMPDIR: directory,
        }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('SHA-256 verification failed for terraform.zip');
      expect(readFileSync(tracePath, 'utf8')).toBe('curl\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('repairs the deploy-owned Web release layout before either activation path', () => {
    const deploy = readFileSync(deployPath, 'utf8');
    const main = deploy.slice(deploy.indexOf('main() {'));
    const result = runShellLibrary(
      deployPath,
      `
run_remote_at() { printf 'directory=%s\\ncommand=%s\\n' "$1" "$2"; }
prepare_remote_web_layout
`,
      {}
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('directory=/opt/intexuraos');
    expect(result.stdout).toContain('web_owner="$(id -un)"');
    expect(result.stdout).toContain('web_group="$(id -gn)"');
    expect(result.stdout).toContain(
      'sudo -n install -d -o "${web_owner}" -g "${web_group}" -m 755 -- /var/www/intexuraos/web /var/www/intexuraos/web/releases'
    );
    expect(result.stdout).toContain('test -w /var/www/intexuraos/web');
    expect(result.stdout).toContain('test -w /var/www/intexuraos/web/releases');
    expect(main.indexOf('prepare_remote_web_layout')).toBeGreaterThan(-1);
    expect(main.indexOf('prepare_remote_web_layout')).toBeLessThan(
      main.indexOf('run_message_digest_cutover')
    );
    expect(main.indexOf('prepare_remote_web_layout')).toBeLessThan(
      main.indexOf('deploy_web_and_edge')
    );
  });

  it('runs first activation without forwarding a Hetzner provider credential', () => {
    const result = runShellLibrary(
      deployPath,
      `
REMOTE_RELEASE_DIR="/opt/intexuraos/releases/${'a'.repeat(40)}"
PREVIOUS_RELEASE_DIR="/opt/intexuraos/releases/${'b'.repeat(40)}"
PREVIOUS_RELEASE_SHA="${'b'.repeat(40)}"
COMMIT_SHA_VALUE="${'a'.repeat(40)}"
TESTED_TREE_VALUE="${'c'.repeat(40)}"
WORKFLOW_RUN_ID_VALUE="123456"
RELEASE_MANIFEST_HASH="${'d'.repeat(64)}"
REMOTE_TERRAFORM_BIN_DIR="/opt/intexuraos/.deployment-tools/terraform/1.5.0"
run_remote() { printf '%s\n' "$1"; }
run_message_digest_cutover
`,
      { HCLOUD_TOKEN: '' }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('cutover-message-digests.sh');
    expect(result.stdout).toContain('PATH=/opt/intexuraos/.deployment-tools/terraform/1.5.0:$PATH');
    expect(result.stdout).not.toContain('HCLOUD_TOKEN');
  });

  it('validates the complete GCP-only cutover inputs without a Hetzner credential', () => {
    const result = runShellLibrary(cutoverPath, 'validate_inputs', {
      HCLOUD_TOKEN: '',
      RELEASE_DIR: repoRoot,
      PREVIOUS_RELEASE_DIR: repoRoot,
      PREVIOUS_RELEASE_SHA: 'a'.repeat(40),
      MERGE_SHA: 'b'.repeat(40),
      TESTED_TREE: 'c'.repeat(40),
      DEPLOYMENT_ID: 'deployment-123',
      RELEASE_MANIFEST_HASH: 'd'.repeat(64),
      ENV_FILE: workflowPath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('strips Hetzner and emulator credentials from closed GCP Terraform commands', () => {
    const result = runShellLibrary(
      cutoverPath,
      `
terraform_environment bash -c 'printf "google=%s\\nhcloud=%s\\nfirestore=%s\\nstorage=%s\\npubsub=%s\\nproject=%s\\nowner=%s\\nconnection=%s\\n" "$GOOGLE_APPLICATION_CREDENTIALS" "\${HCLOUD_TOKEN-unset}" "\${FIRESTORE_EMULATOR_HOST-unset}" "\${STORAGE_EMULATOR_HOST-unset}" "\${PUBSUB_EMULATOR_HOST-unset}" "$TF_VAR_project_id" "$TF_VAR_github_owner" "$TF_VAR_github_connection_name"'
`,
      {
        HCLOUD_TOKEN: 'must-not-flow',
        FIRESTORE_EMULATOR_HOST: 'must-not-flow',
        STORAGE_EMULATOR_HOST: 'must-not-flow',
        PUBSUB_EMULATOR_HOST: 'must-not-flow',
        HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS: '/safe/provisioner.json',
        PROJECT_ID: 'synthetic-project',
        TERRAFORM_GITHUB_OWNER: 'synthetic-owner',
        TERRAFORM_GITHUB_CONNECTION_NAME: 'synthetic-connection',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      'google=/safe/provisioner.json\nhcloud=unset\nfirestore=unset\nstorage=unset\npubsub=unset\nproject=synthetic-project\nowner=synthetic-owner\nconnection=synthetic-connection\n'
    );
  });

  it('reads the legacy Web attestation only until the atomic current release exists', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-legacy-attestation-'));
    const activePath = resolve(directory, 'current', 'deployment.json');
    const legacyPath = resolve(directory, 'dist', 'deployment.json');
    const legacySha = 'b'.repeat(40);
    const activeSha = 'a'.repeat(40);
    mkdirSync(resolve(directory, 'dist'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ commitSha: legacySha }), 'utf8');

    const readSha = (): ReturnType<typeof spawnSync> =>
      runShellLibrary(
        deployPath,
        `
run_remote_at() {
  local directory="$1"
  local command="$2"
  (cd "\${directory}" && bash -c "\${command}")
}
REMOTE_REPO_DIR="$TEST_REMOTE_DIR"
DEPLOYMENT_JSON_PATH="$TEST_ACTIVE_PATH"
LEGACY_DEPLOYMENT_JSON_PATH="$TEST_LEGACY_PATH"
read_served_deployment_sha
`,
        {
          TEST_REMOTE_DIR: directory,
          TEST_ACTIVE_PATH: activePath,
          TEST_LEGACY_PATH: legacyPath,
        }
      );

    try {
      const legacy = readSha();
      expect(legacy.status, legacy.stderr).toBe(0);
      expect(legacy.stdout).toBe(legacySha);

      mkdirSync(resolve(directory, 'current'), { recursive: true });
      writeFileSync(activePath, JSON.stringify({ commitSha: activeSha }), 'utf8');
      const active = readSha();
      expect(active.status, active.stderr).toBe(0);
      expect(active.stdout).toBe(activeSha);

      writeFileSync(activePath, '{"commitSha":"invalid"}', 'utf8');
      const invalidActive = readSha();
      expect(invalidActive.status).not.toBe(0);
      expect(invalidActive.stdout).not.toContain(legacySha);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('distinguishes same-release cutover finalization from later ordinary releases', () => {
    const completedSha = 'c'.repeat(40);
    const laterSha = 'd'.repeat(40);
    const previousSha = 'b'.repeat(40);
    const invoke = (deploymentSha: string): ReturnType<typeof spawnSync> =>
      runShellLibrary(
        deployPath,
        `
read_remote_cutover_status() { printf complete; }
read_remote_cutover_field() {
  case "$1" in
    mergeSha) printf '%s' "$STATE_MERGE_SHA" ;;
    releaseDir) printf '%s' "$STATE_RELEASE_DIR" ;;
    previousReleaseDir) printf '%s' "$STATE_PREVIOUS_RELEASE_DIR" ;;
    *) return 1 ;;
  esac
}
verify_cutover_release_attestation() { :; }
run_remote_at() { printf '%s' "$CURRENT_RELEASE_DIR"; }
COMMIT_SHA_VALUE="$DEPLOYMENT_SHA"
REMOTE_RELEASE_DIR="\${REMOTE_RELEASES_DIR}/\${COMMIT_SHA_VALUE}"
resolve_activation_context
printf '%s|%s' "$ACTIVATION_MODE" "$PREVIOUS_RELEASE_DIR"
`,
        {
          DEPLOYMENT_SHA: deploymentSha,
          STATE_MERGE_SHA: completedSha,
          STATE_RELEASE_DIR: `/opt/intexuraos/releases/${deploymentSha}`,
          STATE_PREVIOUS_RELEASE_DIR: `/opt/intexuraos/releases/${previousSha}`,
          CURRENT_RELEASE_DIR: `/opt/intexuraos/releases/${completedSha}`,
        }
      );

    const sameRelease = invoke(completedSha);
    expect(sameRelease.status, sameRelease.stderr).toBe(0);
    expect(sameRelease.stdout).toBe(`cutover_complete|/opt/intexuraos/releases/${previousSha}`);

    const laterRelease = invoke(laterSha);
    expect(laterRelease.status, laterRelease.stderr).toBe(0);
    expect(laterRelease.stdout).toBe(`ordinary|/opt/intexuraos/releases/${completedSha}`);
  });

  it('keeps same-release cutover finalization free of remote release mutations', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-complete-finalization-'));
    const tracePath = resolve(directory, 'trace.txt');
    try {
      const result = runShellLibrary(
        deployPath,
        `
TRACE_FILE="$TEST_TRACE_FILE"
trace() { printf '%s\\n' "$1" >> "$TRACE_FILE"; }
cleanup() { :; }
require_command() { :; }
validate_inputs() { :; }
resolve_commit_metadata() { trace resolve-commit; }
prepare_sync_source() { trace prepare-local-verification; }
setup_ssh() { trace setup-ssh; }
resolve_activation_context() { ACTIVATION_MODE="cutover_complete"; trace resolve-context; }
sync_repo() { trace sync-repo; }
verify_remote_release_manifest() { trace verify-release; }
cleanup_retired_remote_paths() { trace cleanup-retired; }
prepare_runtime_dependencies() { trace prepare-runtime; }
run_message_digest_cutover() { trace cutover; }
deploy_runtime() { trace deploy-runtime; }
deploy_web_and_edge() { trace deploy-web; }
verify_backend_readiness() { trace verify-backend; }
verify_code_agent_readiness() { trace verify-code; }
verify_runtime_readiness() { trace verify-runtime; }
point_current_release() { trace point-current; }
publish_deployment_metadata() { trace publish-attestation; }
verify_deployment_attestation() { trace verify-attestation; }
main >/dev/null
cat "$TRACE_FILE"
`,
        { TEST_TRACE_FILE: tracePath }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'resolve-commit',
        'prepare-local-verification',
        'setup-ssh',
        'resolve-context',
        'verify-release',
        'verify-backend',
        'verify-code',
        'verify-runtime',
        'publish-attestation',
        'verify-attestation',
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('compensates through a restarted candidate adapter and re-admits an admitted retry', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-compensation-contract-'));
    const tracePath = resolve(directory, 'trace.txt');
    try {
      const result = runShellLibrary(
        cutoverPath,
        `
TRACE_FILE="$TEST_TRACE_FILE"
ATTEMPT_DIR="$TEST_ATTEMPT_DIR"
CUTOVER_STATUS="admitted"
start_candidate_compensation_stack() { printf 'start-candidate\\n' >> "$TRACE_FILE"; }
run_migration_at_whatsapp_url() {
  printf 'migration:%s:%s\\n' "$1" "$3" >> "$TRACE_FILE"
}
stop_candidate_compensation_stack() { printf 'stop-candidate\\n' >> "$TRACE_FILE"; }
public_admission() { printf 'public-admission\\n' >> "$TRACE_FILE"; }
compensate_staged_migration_after_runtime_restore
resume_admitted_public_ingress 16
cat "$TRACE_FILE"
`,
        {
          TEST_TRACE_FILE: tracePath,
          TEST_ATTEMPT_DIR: directory,
        }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'start-candidate',
        'migration:--compensate:http://127.0.0.1:18113',
        'stop-candidate',
        'public-admission',
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('freezes the protected Fishing binding within one attempt and refreshes it for the next', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'message-digest-attempt-binding-'));
    const tracePath = resolve(directory, 'binding-trace.txt');
    try {
      const result = runShellLibrary(
        cutoverPath,
        `
STATE_DIR="$TEST_STATE_DIR"
RELEASE_DIR="$TEST_RELEASE_DIR"
PREVIOUS_RELEASE_DIR="$TEST_PREVIOUS_RELEASE_DIR"
GOOGLE_APPLICATION_CREDENTIALS="$TEST_CREDENTIALS"
PROJECT_ID="synthetic-project"
node() {
  local output=""
  while (($# > 0)); do
    if [[ "$1" == "--output" ]]; then
      shift
      output="$1"
    fi
    shift
  done
  [[ -n "$output" ]] || return 1
  printf 'SYNTHETIC_BINDING=resolved\n' > "$output"
  printf '%s\n' "$output" >> "$TEST_TRACE_FILE"
}
CUTOVER_ATTEMPT=1
configure_attempt_paths
ensure_binding_file
ensure_binding_file
CUTOVER_ATTEMPT=2
configure_attempt_paths
ensure_binding_file
cat "$TEST_TRACE_FILE"
`,
        {
          TEST_STATE_DIR: directory,
          TEST_RELEASE_DIR: repoRoot,
          TEST_PREVIOUS_RELEASE_DIR: repoRoot,
          TEST_CREDENTIALS: resolve(directory, 'credentials.json'),
          TEST_TRACE_FILE: tracePath,
        }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        resolve(directory, 'attempts/1/fishing-binding.env'),
        resolve(directory, 'attempts/2/fishing-binding.env'),
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('runs all four affected services on isolated loopback ports with candidate internal URLs', () => {
    const baseApps = [
      app('whatsapp-service', 8113),
      app('mobile-notifications-service', 8114),
      app('fishing-assistant-service', 8119),
      app('message-digest-service', 8135),
      app('user-service', 8110),
    ];
    const candidate = renderMessageDigestCandidateConfig({ apps: baseApps });

    expect(candidate.apps.map((entry) => entry.name)).toEqual([
      'candidate-whatsapp-service',
      'candidate-mobile-notifications-service',
      'candidate-fishing-assistant-service',
      'candidate-message-digest-service',
    ]);
    expect(candidate.apps.map((entry) => entry.env.PORT)).toEqual([
      '18113',
      '18114',
      '18119',
      '18135',
    ]);
    for (const entry of candidate.apps) {
      expect(entry.env.INTEXURAOS_WHATSAPP_SERVICE_URL).toBe('http://127.0.0.1:18113');
      expect(entry.env.INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL).toBe('http://127.0.0.1:18114');
      expect(entry.env.INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL).toBe('http://127.0.0.1:18119');
      expect(entry.env.INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL).toBe('http://127.0.0.1:18135');
    }
  });

  it('encodes resumable pre-admission steps, inverse order, and an irreversible admission boundary', () => {
    const cutover = readFileSync(cutoverPath, 'utf8');
    const deploy = readFileSync(deployPath, 'utf8');
    const workflow = readFileSync(workflowPath, 'utf8');

    for (const marker of [
      'verify-tested-release',
      'assert-pending-migration-128',
      'start-candidate-stack',
      'migration-dry-run',
      'estimate-window',
      'terraform-dev-forward',
      'migration-128',
      'wait-index-readiness',
      'terraform-prod-forward',
      'terraform-inverse-proof',
      'migration-apply',
      'migration-verify',
      'candidate-zero-send-proof',
      'switch-runtime-under-hold',
      'migration-activate',
      'public-admission',
      'post-admission-verify',
    ]) {
      expect(cutover).toContain(`"${marker}"`);
    }
    expect(cutover.indexOf('forward_terraform_dev')).toBeLessThan(
      cutover.indexOf('forward_terraform_prod')
    );
    const cutoverMain = cutover.slice(cutover.indexOf('main() {'));
    expect(cutoverMain.indexOf('run_step "terraform-prod-forward"')).toBeLessThan(
      cutoverMain.indexOf('run_step "terraform-inverse-proof"')
    );
    expect(cutoverMain.indexOf('run_step "terraform-inverse-proof"')).toBeLessThan(
      cutoverMain.indexOf('run_step "migration-apply"')
    );
    expect(cutover.indexOf('rollback_terraform_prod')).toBeLessThan(
      cutover.indexOf('rollback_terraform_dev')
    );
    expect(cutover).toContain('assertMigration128CutoverReadiness');
    expect(cutover).toContain('--dry-run');
    expect(cutover).toContain('--apply');
    expect(cutover).toContain('--verify');
    expect(cutover).toContain('--activate');
    expect(cutover).toContain('--compensate');
    expect(cutover).toContain('CUTOVER_ADMITTED');
    expect(cutover).toContain('RUNTIME_SWITCH_MARKER');
    expect(cutover).toContain('ACTIVE_VERIFY_REPORT');
    expect(cutover).toContain('verify-message-digest-candidate.mjs');
    expect(cutover).toContain('migration_whatsapp_service_url');
    expect(cutover).toContain('INTEXURAOS_WHATSAPP_SERVICE_URL="${whatsapp_service_url}"');
    expect(cutover).toContain('INTEXURAOS_WHATSAPP_SERVICE_URL="http://127.0.0.1:18113"');
    expect(cutover).toContain('json_text_field "${acquired_json}" cutoverDeadline');
    expect(cutover).toContain('json_text_field "${acquired_json}" attempt');
    expect(cutover).toContain('completedStepCount');
    expect(cutover).toContain('CUTOVER_COMPLETED_STEP_COUNT_INVALID');
    expect(cutover).toContain('assert_cutover_window_open');
    expect(cutover).toContain('if ((index < 15)); then');
    expect(cutover).toContain('rollback_failed');
    expect(cutover).toContain('begin-compensation');
    expect(cutover).toContain('begin-admission');
    expect(cutover).toContain('mark-compensated');
    expect(cutover).toContain('refusing pre-admission compensation after public admission');
    expect(cutover).toContain('/internal/notifications/digest/run-yesterday');
    expect(cutover).toContain('previous immutable release');
    expect(cutover).not.toMatch(/FEATURE_FLAG|ENABLE_MESSAGE_DIGEST/u);

    expect(cutover).toContain('ATTEMPT_DIR="${STATE_DIR}/attempts/${CUTOVER_ATTEMPT}"');
    for (const attemptLocal of [
      'DRY_RUN_REPORT="${ATTEMPT_DIR}/migration-dry-run.json"',
      'RUNTIME_SWITCH_MARKER="${ATTEMPT_DIR}/runtime-switch.complete"',
      'TERRAFORM_DATA_ROOT="${ATTEMPT_DIR}/terraform-data"',
    ]) {
      expect(cutover).toContain(attemptLocal);
    }
    expect(cutover).toContain('"publishTime":"2026-01-01T00:00:00.000Z"');
    const admissionBlock = cutover.slice(cutover.indexOf('if ((completed == 15)); then'));
    expect(admissionBlock.indexOf('begin-admission')).toBeLessThan(
      admissionBlock.indexOf('public_admission')
    );
    expect(admissionBlock.indexOf('public_admission')).toBeLessThan(
      admissionBlock.indexOf('checkpoint "public-admission"')
    );
    expect(admissionBlock.indexOf('elif ((completed == 16)); then')).toBeLessThan(
      admissionBlock.indexOf('run_step "post-admission-verify"')
    );
    expect(admissionBlock.indexOf('resume_admitted_public_ingress')).toBeLessThan(
      admissionBlock.indexOf('run_step "post-admission-verify"')
    );

    const rollbackBlock = cutover.slice(
      cutover.indexOf('rollback_pre_admission() {'),
      cutover.indexOf('\n}\n\non_error()')
    );
    expect(rollbackBlock.indexOf('restore_previous_runtime')).toBeLessThan(
      rollbackBlock.indexOf('compensate_staged_migration_after_runtime_restore')
    );
    const compensationBlock = cutover.slice(
      cutover.indexOf('compensate_staged_migration_after_runtime_restore() {'),
      cutover.indexOf('\n}\n\nmigration_dry_run()')
    );
    expect(compensationBlock.indexOf('start_candidate_compensation_stack')).toBeLessThan(
      compensationBlock.indexOf('run_migration_at_whatsapp_url')
    );
    expect(compensationBlock).toContain('"http://127.0.0.1:18113"');
    expect(compensationBlock.indexOf('run_migration_at_whatsapp_url')).toBeLessThan(
      compensationBlock.lastIndexOf('stop_candidate_compensation_stack')
    );

    const runtimeSwitch = cutover.slice(
      cutover.indexOf('switch_runtime_under_hold() {'),
      cutover.indexOf('\n}\n\nmigration_activate()')
    );
    expect(runtimeSwitch).toContain('--message-digests-full-cutover-hold');
    expect(runtimeSwitch).not.toContain('deploy-web.sh');
    expect(runtimeSwitch).not.toContain('/var/www/intexuraos/web/dist');
    const publicAdmission = cutover.slice(
      cutover.indexOf('public_admission() {'),
      cutover.indexOf('\n}\n\npost_admission_verify()')
    );
    expect(publicAdmission).not.toContain('/var/www/intexuraos/web/dist');
    expect(publicAdmission.indexOf('stage_candidate_web_release')).toBeLessThan(
      publicAdmission.indexOf('activate_candidate_web_release')
    );
    expect(publicAdmission.indexOf('activate_candidate_web_release')).toBeLessThan(
      publicAdmission.indexOf('ln -sfn "${RELEASE_DIR}"')
    );
    expect(publicAdmission.indexOf('ln -sfn "${RELEASE_DIR}"')).toBeLessThan(
      publicAdmission.indexOf('--message-digests-public')
    );
    const stageWebRelease = cutover.slice(
      cutover.indexOf('stage_candidate_web_release() {'),
      cutover.indexOf('\n}\n\nactivate_candidate_web_release()')
    );
    const activateWebRelease = cutover.slice(
      cutover.indexOf('activate_candidate_web_release() {'),
      cutover.indexOf('\n}\n\npublic_admission()')
    );
    expect(cutover).toContain('WEB_RELEASE_DIR="${WEB_RELEASES_ROOT}/${MERGE_SHA}"');
    expect(stageWebRelease).toContain('mktemp -d "${WEB_RELEASES_ROOT}/.${MERGE_SHA}.XXXXXX"');
    expect(stageWebRelease).toContain(
      'rsync -a --delete "${CANDIDATE_WEB_ROOT}/" "${staging_dir}/"'
    );
    expect(stageWebRelease).toContain('mv -T "${staging_dir}" "${WEB_RELEASE_DIR}"');
    expect(stageWebRelease).not.toContain('"${WEB_CURRENT_LINK}/"');
    expect(activateWebRelease).toContain('mktemp "${WEB_CURRENT_LINK}.next.XXXXXX"');
    expect(activateWebRelease).toContain('ln -s "${WEB_RELEASE_DIR}" "${next_link}"');
    expect(activateWebRelease).toContain('mv -Tf "${next_link}" "${WEB_CURRENT_LINK}"');
    expect(cutover).toContain('wait_for_health "http://127.0.0.1:8114/health"');
    expect(cutover).toContain('[[ "${legacy_status}" == "401" ]]');

    const stagedCandidateProof = cutover.slice(
      cutover.indexOf('candidate_zero_send_proof() {'),
      cutover.indexOf('\n}\n\nswitch_runtime_under_hold()')
    );
    expect(stagedCandidateProof).toContain('verify_message_digest_candidate staged');
    const activationProof = cutover.slice(
      cutover.indexOf('migration_activate() {'),
      cutover.indexOf('\n}\n\npublic_admission()')
    );
    expect(activationProof.indexOf('--activate')).toBeLessThan(activationProof.indexOf('--verify'));
    expect(activationProof.indexOf('--verify')).toBeLessThan(
      activationProof.indexOf('verify_message_digest_candidate active')
    );
    expect(cutover.indexOf('verify_message_digest_candidate active')).toBeLessThan(
      admissionBlock.indexOf('begin-admission') + cutover.indexOf('if ((completed == 15)); then')
    );
    for (const invocation of [
      '--whatsapp-port 18113',
      '--mobile-port 18114',
      '--fishing-port 18119',
      '--message-digest-port 18135',
      '--whatsapp-port 8113',
      '--mobile-port 8114',
      '--fishing-port 8119',
      '--message-digest-port 8135',
      '--web-root "${CANDIDATE_WEB_ROOT}"',
      '--dry-run-report "${DRY_RUN_REPORT}"',
      '--apply-report "${APPLY_REPORT}"',
    ]) {
      expect(cutover).toContain(invocation);
    }

    expect(deploy).toContain('verify-github-message-digest-release.mjs');
    expect(deploy).toContain('releases/${COMMIT_SHA_VALUE}');
    expect(deploy).toContain('cutover-message-digests.sh');
    expect(deploy).toContain('RELEASE_MANIFEST_HASH');
    expect(deploy).toContain('in_progress|compensated|admitting|admitted)');
    expect(deploy).toContain('compensating)');
    expect(deploy).toContain('Previous Message Digest compensation is incomplete');
    expect(deploy).toContain('LEGACY_DEPLOYMENT_JSON_PATH');
    const legacySnapshot = deploy.slice(
      deploy.indexOf('snapshot_legacy_release() {'),
      deploy.indexOf('\n}\n\nread_served_deployment_sha()')
    );
    expect(legacySnapshot).toContain('read_served_deployment_sha');
    const deployMain = deploy.slice(deploy.indexOf('main() {'));
    const cutoverCompleteStart = deployMain.indexOf(
      'if [[ "${ACTIVATION_MODE}" == "cutover_complete" ]]'
    );
    const cutoverCompleteBranch = deployMain.slice(
      cutoverCompleteStart,
      deployMain.indexOf('\n  else', cutoverCompleteStart)
    );
    expect(cutoverCompleteBranch).toContain('verify_backend_readiness');
    expect(cutoverCompleteBranch).toContain('verify_remote_release_manifest');
    expect(cutoverCompleteBranch).not.toContain('sync_repo');
    expect(cutoverCompleteBranch).not.toContain('cleanup_retired_remote_paths');
    expect(cutoverCompleteBranch).not.toContain('prepare_runtime_dependencies');
    expect(cutoverCompleteBranch).not.toContain('run_message_digest_cutover');
    expect(cutoverCompleteBranch).not.toContain('deploy_runtime');
    expect(cutoverCompleteBranch).not.toContain('deploy_web_and_edge');
    const syncFlow = deploy.slice(
      deploy.indexOf('sync_repo() {'),
      deploy.indexOf('\n}\n\nverify_remote_release_manifest()')
    );
    expect(syncFlow).not.toContain("--exclude '.env*'");
    expect(deployMain.indexOf('verify_remote_release_manifest')).toBeLessThan(
      deployMain.indexOf('prepare_runtime_dependencies')
    );
    expect(workflow).toContain('timeout-minutes: 210');
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
    expect(workflow).not.toContain('HCLOUD_TOKEN: ${{ secrets.HCLOUD_TOKEN }}');
  });

  it('splits candidate unavailability from the complete affected-ingress hold', () => {
    const deployNginx = readFileSync(nginxDeployPath, 'utf8');
    const nginx = readFileSync(nginxConfigPath, 'utf8');
    const active = readFileSync(activeIngressPath, 'utf8');
    const candidateUnavailable = readFileSync(candidateUnavailableIngressPath, 'utf8');
    const fullHold = readFileSync(fullHoldIngressPath, 'utf8');

    expect(nginx).toContain('include /etc/nginx/intexuraos-message-digest-upstream.conf;');
    expect(nginx).toContain('include /etc/nginx/intexuraos-message-digests-public.conf;');
    expect(nginx).not.toContain(
      'location = /api/message-digests { proxy_pass http://message_digest_service/; }'
    );
    expect(active).toContain('proxy_pass http://message_digest_service/;');
    expect(candidateUnavailable).toContain('location = /api/message-digests');
    expect(candidateUnavailable).not.toContain('/api/notifications/digests');
    expect(candidateUnavailable).not.toContain('/api/fishing-assistant/digests');
    for (const affectedPath of [
      '/api/message-digests',
      '/api/notifications/digests',
      '/internal/notifications/digest/run',
      '/internal/notifications/digest/run-yesterday',
      '/internal/notifications/digest-subscriptions/list',
      '/internal/notifications/digests/query',
      '/internal/notifications/digests/get',
      '/internal/notifications/digest-state/get',
      '/internal/notifications/group-messages/query',
      '/api/fishing-assistant/digest-groups',
      '/api/fishing-assistant/digests',
    ]) {
      expect(fullHold).toContain(affectedPath);
    }
    expect(fullHold).not.toContain('/api/notifications/internal/');
    expect(fullHold).not.toContain('/api/notifications/preferences');
    expect(fullHold).not.toContain('/api/fishing-assistant/health');
    expect(deployNginx).toContain('--message-digests-candidate-unavailable');
    expect(deployNginx).toContain('--message-digests-full-cutover-hold');
    expect(deployNginx).toContain('--message-digests-public');
    expect(deployNginx).toContain('127.0.0.1:18135');
    expect(deployNginx).toContain('127.0.0.1:8135');
  });
});

function readCutoverCliSummary(statePath: string): { completedStepCount: number } {
  return JSON.parse(
    execFileSync(process.execPath, [cutoverStatePath, 'read', '--state', statePath], {
      encoding: 'utf8',
    })
  ) as { completedStepCount: number };
}

function runShellLibrary(
  scriptPath: string,
  body: string,
  extraEnv: Record<string, string>
): ReturnType<typeof spawnSync> {
  return spawnSync('bash', ['-c', `source "$DEPLOY_SCRIPT_PATH"\n${body}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOY_SCRIPT_PATH: scriptPath,
      ...extraEnv,
    },
  });
}

function expectInvalidCutoverCliState(statePath: string): void {
  const result = spawnSync(process.execPath, [cutoverStatePath, 'read', '--state', statePath], {
    encoding: 'utf8',
  });
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/^[A-Z0-9_]+\n$/u);
}

function change(address: string, actions: string[]): Record<string, unknown> {
  return { address, change: { actions } };
}

function app(name: string, port: number): Record<string, unknown> {
  return {
    name,
    cwd: `/release/apps/${name}`,
    script: '/release/node_modules/tsx/dist/cli.mjs',
    args: ['src/index.ts'],
    env: {
      PORT: String(port),
      INTEXURAOS_WHATSAPP_SERVICE_URL: 'http://127.0.0.1:8113',
      INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL: 'http://127.0.0.1:8114',
      INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL: 'http://127.0.0.1:8119',
      INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL: 'http://127.0.0.1:8135',
    },
  };
}

function migrationStatus128(
  targetStatus: 'pending' | 'applied' | 'failed',
  statusOverrides: Record<string, 'pending' | 'applied' | 'failed'> = {}
): string {
  const rows = Array.from({ length: 128 }, (_, index) => {
    const id = String(index + 1).padStart(3, '0');
    const name = id === '128' ? 'message-digest-service-indexes' : `prior-${id}`;
    const status = statusOverrides[id] ?? (id === '128' ? targetStatus : 'applied');
    return `${id} | ${name} | ${status} | ${status === 'applied' ? '2026-07-01' : '-'}`;
  });
  return ['ID | Name | Status | Applied At', ...rows].join('\n');
}
