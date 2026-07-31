#!/usr/bin/env node

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MESSAGE_DIGEST_CUTOVER_STEPS = Object.freeze([
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
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const MIGRATION_PATTERN = /^mdm_[0-9a-f]{40}$/u;
const DEPLOYMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export function acquireCutoverLease(input) {
  validateLeaseInput(input);
  const now = normalizeInstant(input.now);
  const cutoverStart = normalizeInstant(input.cutoverStart);
  const cutoverDeadline = normalizeInstant(input.cutoverDeadline);
  if (Date.parse(cutoverDeadline) <= Date.parse(cutoverStart)) {
    throw safeError('CUTOVER_LEASE_INPUT_INVALID');
  }
  return withStateLock(input.statePath, () => {
    const existing = readOptionalState(input.statePath);
    if (existing !== null) {
      if (existing.status === 'compensated') {
        if (!validCompensatedRetryRelease(existing, input)) {
          throw safeError('CUTOVER_DEPLOYMENT_LEASE_HELD');
        }
        if (existing.attemptHistory.length >= 100) {
          throw safeError('CUTOVER_ATTEMPT_LIMIT_REACHED');
        }
        const retried = {
          ...existing,
          attempt: existing.attempt + 1,
          attemptHistory: [
            ...existing.attemptHistory,
            {
              attempt: existing.attempt,
              migrationId: existing.migrationId,
              mergeSha: existing.mergeSha,
              testedTree: existing.testedTree,
              deploymentId: existing.deploymentId,
              releaseDir: existing.releaseDir,
              previousReleaseDir: existing.previousReleaseDir,
              cutoverStart: existing.cutoverStart,
              cutoverDeadline: existing.cutoverDeadline,
              completedSteps: [...existing.completedSteps],
              compensatedAt: existing.compensatedAt,
            },
          ],
          migrationId: input.migrationId,
          mergeSha: input.mergeSha,
          testedTree: input.testedTree,
          deploymentId: input.deploymentId,
          releaseDir: input.releaseDir,
          previousReleaseDir: input.previousReleaseDir,
          cutoverStart,
          cutoverDeadline,
          status: 'in_progress',
          admitted: false,
          admittingAt: null,
          admittedAt: null,
          compensatedAt: null,
          completedAt: null,
          completedSteps: [],
          lease: {
            owner: input.deploymentId,
            renewedAt: now,
            expiresAt: cutoverDeadline,
          },
          updatedAt: now,
        };
        writeState(input.statePath, retried);
        return retried;
      }
      if (!sameImmutableRelease(existing, input)) {
        throw safeError('CUTOVER_DEPLOYMENT_LEASE_HELD');
      }
      if (existing.deploymentId !== input.deploymentId) {
        throw safeError('CUTOVER_DEPLOYMENT_LEASE_HELD');
      }
      if (existing.status === 'complete') return existing;
      const resumed = {
        ...existing,
        lease: {
          owner: input.deploymentId,
          renewedAt: now,
          expiresAt: existing.cutoverDeadline,
        },
        updatedAt: now,
      };
      writeState(input.statePath, resumed);
      return resumed;
    }
    const state = {
      version: 1,
      migrationId: input.migrationId,
      mergeSha: input.mergeSha,
      testedTree: input.testedTree,
      deploymentId: input.deploymentId,
      releaseDir: input.releaseDir,
      previousReleaseDir: input.previousReleaseDir,
      cutoverStart,
      cutoverDeadline,
      attempt: 1,
      attemptHistory: [],
      status: 'in_progress',
      admitted: false,
      admittingAt: null,
      admittedAt: null,
      compensatedAt: null,
      completedAt: null,
      completedSteps: [],
      lease: {
        owner: input.deploymentId,
        renewedAt: now,
        expiresAt: cutoverDeadline,
      },
      createdAt: now,
      updatedAt: now,
    };
    writeState(input.statePath, state);
    return state;
  });
}

export function completeCutoverCheckpoint(input) {
  validateOperationInput(input);
  if (!MESSAGE_DIGEST_CUTOVER_STEPS.includes(input.step)) {
    throw safeError('CUTOVER_CHECKPOINT_INVALID');
  }
  return withStateLock(input.statePath, () => {
    const state = readRequiredState(input.statePath);
    assertOwner(state, input);
    if (state.completedSteps.includes(input.step)) return state;
    const expected = MESSAGE_DIGEST_CUTOVER_STEPS[state.completedSteps.length];
    if (input.step !== expected) throw safeError('CUTOVER_CHECKPOINT_OUT_OF_ORDER');
    const now = normalizeInstant(input.now);
    if (input.step === 'public-admission') {
      if (state.status !== 'admitting' || state.admitted) {
        throw safeError('CUTOVER_CHECKPOINT_FORBIDDEN');
      }
      const admitted = {
        ...state,
        status: 'admitted',
        admitted: true,
        admittedAt: now,
        completedSteps: [...state.completedSteps, input.step],
        lease: { owner: input.deploymentId, renewedAt: now, expiresAt: state.cutoverDeadline },
        updatedAt: now,
      };
      writeState(input.statePath, admitted);
      return admitted;
    }
    const allowedStatus = input.step === 'post-admission-verify' ? 'admitted' : 'in_progress';
    if (state.status !== allowedStatus) throw safeError('CUTOVER_CHECKPOINT_FORBIDDEN');
    const next = {
      ...state,
      completedSteps: [...state.completedSteps, input.step],
      lease: { owner: input.deploymentId, renewedAt: now, expiresAt: state.cutoverDeadline },
      updatedAt: now,
    };
    writeState(input.statePath, next);
    return next;
  });
}

export function beginPublicAdmission(input) {
  validateOperationInput(input);
  return withStateLock(input.statePath, () => {
    const state = readRequiredState(input.statePath);
    assertOwner(state, input);
    if (state.status === 'admitting') return state;
    if (
      state.status !== 'in_progress' ||
      state.completedSteps.length !== 15 ||
      MESSAGE_DIGEST_CUTOVER_STEPS[state.completedSteps.length] !== 'public-admission'
    ) {
      throw safeError('CUTOVER_ADMISSION_FORBIDDEN');
    }
    const now = normalizeInstant(input.now);
    const admitting = {
      ...state,
      status: 'admitting',
      admittingAt: now,
      lease: { owner: input.deploymentId, renewedAt: now, expiresAt: state.cutoverDeadline },
      updatedAt: now,
    };
    writeState(input.statePath, admitting);
    return admitting;
  });
}

export function beginCutoverCompensation(input) {
  validateOperationInput(input);
  return withStateLock(input.statePath, () => {
    const state = readRequiredState(input.statePath);
    assertOwner(state, input);
    if (hasAdmissionIntent(state)) {
      throw safeError('CUTOVER_COMPENSATION_FORBIDDEN_AFTER_ADMISSION');
    }
    if (state.status === 'compensated') return state;
    if (state.status !== 'in_progress' && state.status !== 'compensating') {
      throw safeError('CUTOVER_COMPENSATION_FORBIDDEN');
    }
    const now = normalizeInstant(input.now);
    const compensating = {
      ...state,
      status: 'compensating',
      lease: { owner: input.deploymentId, renewedAt: now, expiresAt: state.cutoverDeadline },
      updatedAt: now,
    };
    writeState(input.statePath, compensating);
    return compensating;
  });
}

export function markCutoverCompensated(input) {
  validateOperationInput(input);
  return withStateLock(input.statePath, () => {
    const state = readRequiredState(input.statePath);
    assertOwner(state, input);
    if (hasAdmissionIntent(state)) {
      throw safeError('CUTOVER_COMPENSATION_FORBIDDEN_AFTER_ADMISSION');
    }
    if (state.status === 'compensated') return state;
    if (state.status !== 'compensating') {
      throw safeError('CUTOVER_COMPENSATION_FORBIDDEN');
    }
    const now = normalizeInstant(input.now);
    const compensated = {
      ...state,
      status: 'compensated',
      compensatedAt: now,
      lease: null,
      updatedAt: now,
    };
    writeState(input.statePath, compensated);
    return compensated;
  });
}

export function assertPreAdmissionCompensationAllowed(statePath) {
  const state = readRequiredState(statePath);
  if (hasAdmissionIntent(state)) {
    throw safeError('CUTOVER_COMPENSATION_FORBIDDEN_AFTER_ADMISSION');
  }
  return state;
}

export function markCutoverComplete(input) {
  validateOperationInput(input);
  return withStateLock(input.statePath, () => {
    const state = readRequiredState(input.statePath);
    assertOwner(state, input);
    if (state.status === 'complete') return state;
    if (
      state.status !== 'admitted' ||
      !state.admitted ||
      state.completedSteps.length !== MESSAGE_DIGEST_CUTOVER_STEPS.length
    ) {
      throw safeError('CUTOVER_COMPLETION_FORBIDDEN');
    }
    const now = normalizeInstant(input.now);
    const complete = {
      ...state,
      status: 'complete',
      completedAt: now,
      lease: null,
      updatedAt: now,
    };
    writeState(input.statePath, complete);
    return complete;
  });
}

function sameImmutableRelease(state, input) {
  return (
    state.migrationId === input.migrationId &&
    state.mergeSha === input.mergeSha &&
    state.testedTree === input.testedTree &&
    state.releaseDir === input.releaseDir &&
    state.previousReleaseDir === input.previousReleaseDir
  );
}

function validCompensatedRetryRelease(state, input) {
  if (state.previousReleaseDir !== input.previousReleaseDir) return false;
  if (sameImmutableRelease(state, input)) return true;
  return (
    input.migrationId === `mdm_${input.mergeSha}` &&
    input.mergeSha !== state.mergeSha &&
    input.releaseDir.endsWith(`/${input.mergeSha}`)
  );
}

function hasAdmissionIntent(state) {
  return state.admitted || ['admitting', 'admitted', 'complete'].includes(state.status);
}

export function readCutoverState(statePath) {
  return readRequiredState(statePath);
}

function validateLeaseInput(input) {
  if (
    !isRecord(input) ||
    !validStatePath(input.statePath) ||
    typeof input.migrationId !== 'string' ||
    !MIGRATION_PATTERN.test(input.migrationId) ||
    typeof input.mergeSha !== 'string' ||
    !SHA_PATTERN.test(input.mergeSha) ||
    typeof input.testedTree !== 'string' ||
    !SHA_PATTERN.test(input.testedTree) ||
    typeof input.deploymentId !== 'string' ||
    !DEPLOYMENT_PATTERN.test(input.deploymentId) ||
    !validReleasePath(input.releaseDir) ||
    !validReleasePath(input.previousReleaseDir)
  ) {
    throw safeError('CUTOVER_LEASE_INPUT_INVALID');
  }
  normalizeInstant(input.cutoverStart);
  normalizeInstant(input.cutoverDeadline);
  normalizeInstant(input.now);
}

function validateOperationInput(input) {
  if (
    !isRecord(input) ||
    !validStatePath(input.statePath) ||
    typeof input.migrationId !== 'string' ||
    !MIGRATION_PATTERN.test(input.migrationId) ||
    typeof input.deploymentId !== 'string' ||
    !DEPLOYMENT_PATTERN.test(input.deploymentId)
  ) {
    throw safeError('CUTOVER_OPERATION_INPUT_INVALID');
  }
  normalizeInstant(input.now);
}

function validStatePath(value) {
  return typeof value === 'string' && isAbsolute(value) && value.length <= 4_096;
}

function validReleasePath(value) {
  return (
    typeof value === 'string' &&
    isAbsolute(value) &&
    value.length <= 4_096 &&
    !value.split('/').includes('..')
  );
}

function normalizeInstant(value) {
  if (typeof value !== 'string') throw safeError('CUTOVER_INSTANT_INVALID');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw safeError('CUTOVER_INSTANT_INVALID');
  return new Date(timestamp).toISOString();
}

function assertOwner(state, input) {
  if (
    state.migrationId !== input.migrationId ||
    state.deploymentId !== input.deploymentId ||
    (state.lease !== null && state.lease.owner !== input.deploymentId)
  ) {
    throw safeError('CUTOVER_DEPLOYMENT_LEASE_HELD');
  }
}

function readOptionalState(statePath) {
  if (!existsSync(statePath)) return null;
  return readRequiredState(statePath);
}

function readRequiredState(statePath) {
  if (!validStatePath(statePath) || !existsSync(statePath)) {
    throw safeError('CUTOVER_STATE_NOT_FOUND');
  }
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    throw safeError('CUTOVER_STATE_INVALID');
  }
  if (
    !isRecord(state) ||
    state.version !== 1 ||
    typeof state.migrationId !== 'string' ||
    !MIGRATION_PATTERN.test(state.migrationId) ||
    !Array.isArray(state.completedSteps) ||
    state.completedSteps.some((step, index) => step !== MESSAGE_DIGEST_CUTOVER_STEPS[index]) ||
    typeof state.admitted !== 'boolean' ||
    !Number.isInteger(state.attempt) ||
    state.attempt < 1 ||
    !Array.isArray(state.attemptHistory) ||
    state.attemptHistory.length > 100 ||
    state.attemptHistory.some((attempt) => !validAttemptHistory(attempt)) ||
    !['in_progress', 'compensating', 'compensated', 'admitting', 'admitted', 'complete'].includes(
      state.status
    ) ||
    state.admitted !== ['admitted', 'complete'].includes(state.status) ||
    (['admitting', 'admitted', 'complete'].includes(state.status)
      ? typeof state.admittingAt !== 'string' || !Number.isFinite(Date.parse(state.admittingAt))
      : state.admittingAt !== null) ||
    (state.admitted
      ? typeof state.admittedAt !== 'string' || !Number.isFinite(Date.parse(state.admittedAt))
      : state.admittedAt !== null) ||
    (state.status === 'compensated' &&
      (typeof state.compensatedAt !== 'string' || state.lease !== null))
  ) {
    throw safeError('CUTOVER_STATE_INVALID');
  }
  return state;
}

function validAttemptHistory(value) {
  return (
    isRecord(value) &&
    Number.isInteger(value.attempt) &&
    value.attempt >= 1 &&
    typeof value.migrationId === 'string' &&
    MIGRATION_PATTERN.test(value.migrationId) &&
    typeof value.mergeSha === 'string' &&
    SHA_PATTERN.test(value.mergeSha) &&
    typeof value.testedTree === 'string' &&
    SHA_PATTERN.test(value.testedTree) &&
    typeof value.deploymentId === 'string' &&
    DEPLOYMENT_PATTERN.test(value.deploymentId) &&
    validReleasePath(value.releaseDir) &&
    validReleasePath(value.previousReleaseDir) &&
    Number.isFinite(Date.parse(value.cutoverStart)) &&
    Number.isFinite(Date.parse(value.cutoverDeadline)) &&
    Number.isFinite(Date.parse(value.compensatedAt)) &&
    Array.isArray(value.completedSteps) &&
    value.completedSteps.every((step, index) => step === MESSAGE_DIGEST_CUTOVER_STEPS[index])
  );
}

function withStateLock(statePath, operation) {
  const stateDirectory = dirname(statePath);
  const lockPath = `${statePath}.lock`;
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch {
    throw safeError('CUTOVER_STATE_BUSY');
  }
  try {
    return operation();
  } finally {
    rmdirSync(lockPath);
  }
}

function writeState(statePath, state) {
  const directory = dirname(statePath);
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, statePath);
  const directoryDescriptor = openSync(directory, 'r');
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function safeError(code) {
  return new Error(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCliArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || argv[index + 1] === undefined) {
      throw safeError('CUTOVER_ARGUMENTS_INVALID');
    }
    values[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function required(values, name) {
  const value = values[name];
  if (typeof value !== 'string' || value === '') throw safeError('CUTOVER_ARGUMENTS_INVALID');
  return value;
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath !== null && entryPath === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const values = parseCliArgs(process.argv.slice(3));
    let state;
    if (command === 'acquire') {
      state = acquireCutoverLease({
        statePath: required(values, 'state'),
        migrationId: required(values, 'migration-id'),
        mergeSha: required(values, 'merge-sha'),
        testedTree: required(values, 'tested-tree'),
        deploymentId: required(values, 'deployment-id'),
        releaseDir: required(values, 'release-dir'),
        previousReleaseDir: required(values, 'previous-release-dir'),
        cutoverStart: required(values, 'cutover-start'),
        cutoverDeadline: required(values, 'cutover-deadline'),
        now: required(values, 'now'),
      });
    } else if (command === 'checkpoint') {
      state = completeCutoverCheckpoint({
        statePath: required(values, 'state'),
        migrationId: required(values, 'migration-id'),
        deploymentId: required(values, 'deployment-id'),
        step: required(values, 'step'),
        now: required(values, 'now'),
      });
    } else if (command === 'begin-admission') {
      state = beginPublicAdmission({
        statePath: required(values, 'state'),
        migrationId: required(values, 'migration-id'),
        deploymentId: required(values, 'deployment-id'),
        now: required(values, 'now'),
      });
    } else if (command === 'begin-compensation') {
      state = beginCutoverCompensation({
        statePath: required(values, 'state'),
        migrationId: required(values, 'migration-id'),
        deploymentId: required(values, 'deployment-id'),
        now: required(values, 'now'),
      });
    } else if (command === 'mark-compensated') {
      state = markCutoverCompensated({
        statePath: required(values, 'state'),
        migrationId: required(values, 'migration-id'),
        deploymentId: required(values, 'deployment-id'),
        now: required(values, 'now'),
      });
    } else if (command === 'assert-compensation') {
      state = assertPreAdmissionCompensationAllowed(required(values, 'state'));
    } else if (command === 'complete') {
      state = markCutoverComplete({
        statePath: required(values, 'state'),
        migrationId: required(values, 'migration-id'),
        deploymentId: required(values, 'deployment-id'),
        now: required(values, 'now'),
      });
    } else if (command === 'read') {
      state = readCutoverState(required(values, 'state'));
    } else {
      throw safeError('CUTOVER_ARGUMENTS_INVALID');
    }
    process.stdout.write(
      `${JSON.stringify({
        status: state.status,
        admitted: state.admitted,
        attempt: state.attempt,
        completedStepCount: state.completedSteps.length,
        cutoverStart: state.cutoverStart,
        cutoverDeadline: state.cutoverDeadline,
      })}\n`
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : 'CUTOVER_EXECUTION_FAILED';
    process.stderr.write(`${/^[A-Z0-9_]+$/u.test(code) ? code : 'CUTOVER_EXECUTION_FAILED'}\n`);
    process.exitCode = 1;
  }
}
