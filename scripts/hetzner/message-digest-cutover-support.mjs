#!/usr/bin/env node

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;
const THIRTY_MINUTES_MS = 30 * 60 * 1_000;

const TERRAFORM_CONTRACTS = Object.freeze({
  dev: new Map([
    ['google_service_account.message_digest_service', 'create'],
    ['google_pubsub_topic.message_digest_runs', 'create'],
    ['google_pubsub_topic_iam_member.message_digest_publishes_runs', 'create'],
    ['google_pubsub_topic_iam_member.message_digest_publishes_whatsapp', 'create'],
  ]),
  prod: new Map([
    ['google_pubsub_topic.hetzner_push_dlq["message_digest_runs"]', 'create'],
    ['google_pubsub_subscription.hetzner_push_dlq_inspect["message_digest_runs"]', 'create'],
    ['google_pubsub_topic_iam_member.hetzner_push_dlq_publisher["message_digest_runs"]', 'create'],
    ['google_pubsub_subscription.hetzner_push["message_digest_runs"]', 'create'],
    [
      'google_pubsub_subscription_iam_member.hetzner_push_dlq_subscriber["message_digest_runs"]',
      'create',
    ],
    ['google_cloud_scheduler_job.hetzner_http["message_digest_tick"]', 'create'],
    ['google_cloud_scheduler_job.hetzner_http["mobile_notifications_digest_yesterday"]', 'delete'],
  ]),
  'dev-inverse': new Map([
    ['google_service_account.message_digest_service', 'delete'],
    ['google_pubsub_topic.message_digest_runs', 'delete'],
    ['google_pubsub_topic_iam_member.message_digest_publishes_runs', 'delete'],
    ['google_pubsub_topic_iam_member.message_digest_publishes_whatsapp', 'delete'],
  ]),
  'prod-inverse': new Map([
    ['google_pubsub_topic.hetzner_push_dlq["message_digest_runs"]', 'delete'],
    ['google_pubsub_subscription.hetzner_push_dlq_inspect["message_digest_runs"]', 'delete'],
    ['google_pubsub_topic_iam_member.hetzner_push_dlq_publisher["message_digest_runs"]', 'delete'],
    ['google_pubsub_subscription.hetzner_push["message_digest_runs"]', 'delete'],
    [
      'google_pubsub_subscription_iam_member.hetzner_push_dlq_subscriber["message_digest_runs"]',
      'delete',
    ],
    ['google_cloud_scheduler_job.hetzner_http["message_digest_tick"]', 'delete'],
    ['google_cloud_scheduler_job.hetzner_http["mobile_notifications_digest_yesterday"]', 'create'],
  ]),
});

const COMPLETE_INVERSE_TERRAFORM_CONTRACTS = Object.freeze({
  'dev-inverse-complete': TERRAFORM_CONTRACTS['dev-inverse'],
  'prod-inverse-complete': TERRAFORM_CONTRACTS['prod-inverse'],
});

export function parseTestedTreeTrailer(message) {
  if (typeof message !== 'string' || message.length > 100_000) {
    throw safeError('CUTOVER_TESTED_TREE_TRAILER_INVALID');
  }
  const lines = message.split(/\r?\n/u);
  const matches = lines.flatMap((line) => {
    const match = /^Tested-Tree: ([0-9a-f]{40})$/u.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  const lastNonEmpty = [...lines].reverse().find((line) => line.trim() !== '');
  if (matches.length !== 1 || lastNonEmpty !== `Tested-Tree: ${matches[0]}`) {
    throw safeError('CUTOVER_TESTED_TREE_TRAILER_INVALID');
  }
  return matches[0];
}

export function verifyReleaseAttestation(input) {
  if (
    !isRecord(input) ||
    ![input.mergeSha, input.mergeTree, input.prHeadSha, input.prHeadTree, input.stagedTree].every(
      (value) => typeof value === 'string' && SHA_PATTERN.test(value)
    )
  ) {
    throw safeError('CUTOVER_RELEASE_ATTESTATION_INVALID');
  }
  const testedTree = parseTestedTreeTrailer(input.prHeadCommitMessage);
  if (
    testedTree !== input.prHeadTree ||
    testedTree !== input.mergeTree ||
    testedTree !== input.stagedTree
  ) {
    throw safeError('CUTOVER_TREE_MISMATCH');
  }
  return {
    mergeSha: input.mergeSha,
    prHeadSha: input.prHeadSha,
    testedTree,
  };
}

export function deriveMessageDigestMigrationId(mergeSha) {
  if (typeof mergeSha !== 'string' || !SHA_PATTERN.test(mergeSha)) {
    throw safeError('CUTOVER_RELEASE_ATTESTATION_INVALID');
  }
  return `mdm_${mergeSha}`;
}

export function computeCutoverWindow(start) {
  const cutoverStartMs = Date.parse(start);
  if (!Number.isFinite(cutoverStartMs)) throw safeError('CUTOVER_START_INVALID');
  const cutoverStart = new Date(cutoverStartMs).toISOString();
  const startDate = new Date(cutoverStartMs);
  let nextLegacyMs = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
    1
  );
  if (nextLegacyMs <= cutoverStartMs) nextLegacyMs += 24 * 60 * 60 * 1_000;
  const deadlineMs = Math.min(cutoverStartMs + TWO_HOURS_MS, nextLegacyMs - THIRTY_MINUTES_MS);
  if (deadlineMs <= cutoverStartMs) throw safeError('CUTOVER_WINDOW_CLOSED');
  return {
    cutoverStart,
    cutoverDeadline: new Date(deadlineMs).toISOString(),
    nextLegacyBoundary: new Date(nextLegacyMs).toISOString(),
  };
}

export function estimateCutoverDurationSeconds(input) {
  if (
    !isRecord(input) ||
    !Number.isInteger(input.replayDates) ||
    input.replayDates < 0 ||
    input.replayDates > 10_000 ||
    !Number.isInteger(input.terraformChanges) ||
    input.terraformChanges < 0 ||
    input.terraformChanges > 1_000
  ) {
    throw safeError('CUTOVER_ESTIMATE_INVALID');
  }
  const rollbackMarginSeconds = 30 * 60;
  const indexReadinessSeconds = 20 * 60;
  const candidateAndAdmissionSeconds = 10 * 60;
  const replaySeconds = input.replayDates * 30;
  const terraformSeconds = input.terraformChanges * 20;
  return {
    replayDates: input.replayDates,
    terraformChanges: input.terraformChanges,
    rollbackMarginSeconds,
    totalSeconds:
      rollbackMarginSeconds +
      indexReadinessSeconds +
      candidateAndAdmissionSeconds +
      replaySeconds +
      terraformSeconds,
  };
}

export function assertCutoverEstimateFits(window, estimate) {
  if (
    !isRecord(window) ||
    !isRecord(estimate) ||
    !Number.isFinite(Date.parse(window.cutoverStart)) ||
    !Number.isFinite(Date.parse(window.cutoverDeadline)) ||
    !Number.isInteger(estimate.totalSeconds) ||
    estimate.totalSeconds < 1 ||
    !Number.isInteger(estimate.rollbackMarginSeconds) ||
    estimate.rollbackMarginSeconds < 30 * 60
  ) {
    throw safeError('CUTOVER_ESTIMATE_INVALID');
  }
  const availableSeconds = Math.floor(
    (Date.parse(window.cutoverDeadline) - Date.parse(window.cutoverStart)) / 1_000
  );
  if (availableSeconds < estimate.totalSeconds) {
    throw safeError('CUTOVER_ESTIMATE_EXCEEDS_DEADLINE');
  }
  return { availableSeconds, ...estimate };
}

export function assertMigration128CutoverReadiness(statusOutput) {
  if (typeof statusOutput !== 'string' || statusOutput.length > 1_000_000) {
    throw safeError('CUTOVER_PENDING_MIGRATIONS_INVALID');
  }
  const records = statusOutput.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d{3})\s*\|\s*([^|]+?)\s*\|\s*([a-z_]+)\s*\|/u.exec(line);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return [];
    return [{ id: match[1], name: match[2], status: match[3] }];
  });
  const ids = new Set(records.map((record) => record.id));
  const target = records.find((record) => record.id === '128');
  if (
    records.length !== 128 ||
    ids.size !== records.length ||
    records.some((record, index) => record.id !== String(index + 1).padStart(3, '0')) ||
    target === undefined ||
    target.name !== 'message-digest-service-indexes' ||
    !['pending', 'applied'].includes(target.status) ||
    records.some(
      (record) =>
        record.id > '128' ||
        (record.id < '128' && record.status !== 'applied') ||
        (record.id === '128' && record !== target)
    )
  ) {
    throw safeError('CUTOVER_PENDING_MIGRATIONS_INVALID');
  }
  return {
    migrationId: '128',
    mode: target.status === 'pending' ? 'pending' : 'already_applied',
  };
}

export function validateTerraformPlan(root, plan) {
  const expected = TERRAFORM_CONTRACTS[root] ?? COMPLETE_INVERSE_TERRAFORM_CONTRACTS[root];
  const allowSubset = root === 'dev-inverse' || root === 'prod-inverse';
  if (expected === undefined || !isRecord(plan) || !Array.isArray(plan.resource_changes)) {
    throw safeError('CUTOVER_TERRAFORM_PLAN_UNSAFE');
  }
  const observed = new Map();
  for (const resource of plan.resource_changes) {
    if (
      !isRecord(resource) ||
      !isRecord(resource.change) ||
      !Array.isArray(resource.change.actions)
    ) {
      throw safeError('CUTOVER_TERRAFORM_PLAN_UNSAFE');
    }
    if (resource.change.actions.length === 1 && resource.change.actions[0] === 'no-op') continue;
    if (
      typeof resource.address !== 'string' ||
      resource.change.actions.length !== 1 ||
      typeof resource.change.actions[0] !== 'string' ||
      observed.has(resource.address)
    ) {
      throw safeError('CUTOVER_TERRAFORM_PLAN_UNSAFE');
    }
    observed.set(resource.address, resource.change.actions[0]);
  }
  if (!allowSubset && observed.size !== expected.size) {
    throw safeError('CUTOVER_TERRAFORM_PLAN_UNSAFE');
  }
  for (const [address, action] of observed) {
    if (expected.get(address) !== action) throw safeError('CUTOVER_TERRAFORM_PLAN_UNSAFE');
  }
  if (!allowSubset) {
    for (const [address, action] of expected) {
      if (observed.get(address) !== action) throw safeError('CUTOVER_TERRAFORM_PLAN_UNSAFE');
    }
  }
  return [...observed.entries()].map(([address, action]) => ({ address, action }));
}

function safeError(code) {
  return new Error(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
