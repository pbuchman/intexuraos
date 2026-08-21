#!/usr/bin/env node

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const RETIRED_WORKER_TYPES = new Set(['minimax', 'mimo-pro', 'glm', 'qwen', 'kimi']);
export const RETIRED_LLM_PROVIDERS = new Set(['google', 'openai', 'anthropic', 'perplexity']);
const DEFAULT_FIELDS = [
  'defaultReviewWorkerType',
  'defaultRemediationWorkerType',
  'defaultExecutionWorkerType',
  'defaultPlanningWorkerType',
  'defaultPullRequestWorkerType',
  'defaultSentryWorkerType',
];
const NONTERMINAL_TASK_STATUSES = new Set(['queued', 'dispatched', 'running']);
const MATRIX_ALGORITHM = 'aes-256-gcm';
const MATRIX_RUNTIME_AUDIENCE = 'hetzner-prod';

function fail(message) {
  throw new Error(message);
}

export function decodeKey(value, label) {
  const key = Buffer.from(value, 'base64');
  if (key.byteLength !== 32) fail(`${label} must decode to exactly 32 bytes`);
  return key;
}

export function encryptAppValue(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptAppValue(encrypted, key) {
  if (typeof encrypted !== 'object' || encrypted === null) fail('malformed application envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptTokenValue(plaintext, key) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptTokenValue(encrypted, key) {
  if (typeof encrypted !== 'string') fail('malformed token envelope');
  const parts = encrypted.split(':');
  if (parts.length !== 3) fail('malformed token envelope');
  const [iv, tag, ciphertext] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function matrixAssociatedData(binding) {
  return Buffer.from(
    JSON.stringify({
      version: binding.version,
      kind: binding.kind,
      runtimeAudience: binding.runtimeAudience,
      runId: binding.runId,
      userId: binding.userId,
      leaseFence: binding.leaseFence,
      ...('scenarioId' in binding ? { scenarioId: binding.scenarioId } : {}),
      ...('sessionId' in binding ? { sessionId: binding.sessionId } : {}),
      ...('confirmationId' in binding ? { confirmationId: binding.confirmationId } : {}),
      ...(binding.kind === 'test_confirmation_tool_args'
        ? {
            toolName: binding.toolName,
            selectionTurnIndex: binding.selectionTurnIndex,
            selectionOrdinal: binding.selectionOrdinal,
            createdAt: binding.createdAt,
            expiresAt: binding.expiresAt,
            state: binding.state,
            decision: binding.decision,
            resolutionMessageId: binding.resolutionMessageId,
            resolvedAt: binding.resolvedAt,
          }
        : {}),
    }),
    'utf8'
  );
}

export function matrixRunBinding(input) {
  return {
    version: 1,
    kind: 'run_prompt_context',
    runtimeAudience: MATRIX_RUNTIME_AUDIENCE,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
  };
}

export function matrixScenarioBinding(input) {
  return {
    version: 1,
    kind: 'scenario_prompt_context',
    runtimeAudience: MATRIX_RUNTIME_AUDIENCE,
    runId: input.runId,
    scenarioId: input.scenarioId,
    userId: input.userId,
    leaseFence: input.leaseFence,
  };
}

export function matrixConfirmationBinding(input, userId) {
  return {
    version: 1,
    kind: 'test_confirmation_tool_args',
    runtimeAudience: MATRIX_RUNTIME_AUDIENCE,
    confirmationId: input.confirmationId,
    runId: input.runId,
    scenarioId: input.scenarioId,
    sessionId: input.sessionId,
    userId,
    leaseFence: input.leaseFence,
    toolName: input.toolName,
    selectionTurnIndex: input.selectionTurnIndex,
    selectionOrdinal: input.selectionOrdinal,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    state: input.state,
    decision: input.decision,
    resolutionMessageId: input.resolutionMessageId,
    resolvedAt: input.resolvedAt,
  };
}

export function encryptMatrixValue(plaintext, key, keyVersion, binding) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(MATRIX_ALGORITHM, key, nonce, { authTagLength: 16 });
  cipher.setAAD(matrixAssociatedData(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    algorithm: MATRIX_ALGORITHM,
    keyVersion,
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authenticationTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptMatrixValue(encrypted, key, keyVersion, binding) {
  if (encrypted?.algorithm !== MATRIX_ALGORITHM || encrypted.keyVersion !== keyVersion) {
    fail('unknown Matrix key version');
  }
  try {
    const decipher = createDecipheriv(
      MATRIX_ALGORITHM,
      key,
      Buffer.from(encrypted.nonce, 'base64url'),
      { authTagLength: 16 }
    );
    decipher.setAAD(matrixAssociatedData(binding));
    decipher.setAuthTag(Buffer.from(encrypted.authenticationTag, 'base64url'));
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
        decipher.final(),
      ])
    );
  } catch {
    fail('Matrix authentication failed');
  }
}

export function reencryptMatrixValue(encrypted, binding, oldKey, oldVersion, newKey, newVersion) {
  const plaintext = decryptMatrixValue(encrypted, oldKey, oldVersion, binding);
  const replacement = encryptMatrixValue(plaintext, newKey, newVersion, binding);
  if (decryptMatrixValue(replacement, newKey, newVersion, binding) !== plaintext) {
    fail('Matrix plaintext mismatch');
  }
  if (Buffer.from(oldKey).equals(Buffer.from(newKey)) && oldVersion === newVersion) {
    return replacement;
  }
  try {
    decryptMatrixValue(replacement, oldKey, newVersion, binding);
  } catch {
    return replacement;
  }
  fail('old Matrix key decrypts replacement');
}

export function transformUserSettings(data, oldKey, newKey) {
  const keys = data.llmApiKeys === undefined ? {} : { ...data.llmApiKeys };
  const testResults = data.llmTestResults === undefined ? {} : { ...data.llmTestResults };
  let intentionallyDeleted = 0;
  let retiredArtifacts = 0;
  let changed = false;
  for (const provider of RETIRED_LLM_PROVIDERS) {
    if (keys[provider] !== undefined) {
      intentionallyDeleted += 1;
      changed = true;
    }
    if (testResults[provider] !== undefined) {
      retiredArtifacts += 1;
      changed = true;
    }
    delete keys[provider];
    delete testResults[provider];
  }
  let migrated = 0;
  if (keys.openrouter !== undefined) {
    const plaintext = decryptAppValue(keys.openrouter, oldKey);
    keys.openrouter = encryptAppValue(plaintext, newKey);
    migrated = 1;
    changed = true;
  }
  const defaultModel = data.defaultModel;
  const fallbackModel = data.fallbackModel;
  const deleteDefaultModel = typeof defaultModel === 'string' && !defaultModel.startsWith('or:');
  const deleteFallbackModel = typeof fallbackModel === 'string' && !fallbackModel.startsWith('or:');
  retiredArtifacts += Number(deleteDefaultModel) + Number(deleteFallbackModel);
  changed ||= deleteDefaultModel || deleteFallbackModel;
  return {
    data: { ...data, llmApiKeys: keys, llmTestResults: testResults },
    intentionallyDeleted,
    migrated,
    changed,
    deleteDefaultModel,
    deleteFallbackModel,
    retiredArtifacts,
  };
}

export function transformWorkerSettings(data, oldKey, newKey) {
  const workers = Array.isArray(data.workers)
    ? data.workers.map((worker) => ({
        ...worker,
        cfAccessClientId: encryptTokenValue(
          decryptTokenValue(worker.cfAccessClientId, oldKey),
          newKey
        ),
        cfAccessClientSecret: encryptTokenValue(
          decryptTokenValue(worker.cfAccessClientSecret, oldKey),
          newKey
        ),
        dispatchSigningSecret: encryptTokenValue(
          decryptTokenValue(worker.dispatchSigningSecret, oldKey),
          newKey
        ),
      }))
    : fail('worker settings workers must be an array');
  const retiredDefaults = DEFAULT_FIELDS.filter((field) => RETIRED_WORKER_TYPES.has(data[field]));
  return { workers, retiredDefaults };
}

function readPrivateKeyFile(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    fail(`${label} must be a private regular file`);
  }
  const value = readFileSync(path, 'utf8').replace(/\r?\n$/u, '');
  if (value === '' || /[\r\n\0]/u.test(value)) fail(`${label} is invalid`);
  return decodeKey(value, label);
}

function readPrivateMatrixKeyFile(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    fail(`${label} must be a private regular file`);
  }
  const value = readFileSync(path, 'utf8').replace(/\r?\n$/u, '');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) fail(`${label} must be canonical base64url`);
  const key = Buffer.from(value, 'base64url');
  if (key.byteLength !== 32 || key.toString('base64url') !== value) {
    fail(`${label} must decode to exactly 32 bytes`);
  }
  return key;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || value === undefined || !name.startsWith('--'))
      fail('invalid arguments');
    options[name.slice(2)] = value;
  }
  const required = [
    'mode',
    'project-id',
    'old-app-key-file',
    'new-app-key-file',
    'old-token-key-file',
    'new-token-key-file',
    'old-matrix-key-file',
    'new-matrix-key-file',
    'old-matrix-key-version',
    'new-matrix-key-version',
  ];
  for (const name of required) if (options[name] === undefined) fail(`--${name} is required`);
  if (!['plan', 'apply'].includes(options.mode)) fail('--mode must be plan or apply');
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isExpired(value, nowMs) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= nowMs;
}

function matrixIdentity(data) {
  if (
    typeof data.runId !== 'string' ||
    typeof data.userId !== 'string' ||
    typeof data.leaseFence !== 'string'
  ) {
    return undefined;
  }
  return { runId: data.runId, userId: data.userId, leaseFence: data.leaseFence };
}

function recordMatrixMigration(report) {
  report.candidate += 1;
  report.migrated += 1;
  report.old_decrypt_ok += 1;
  report.new_decrypt_ok += 1;
  report.plaintext_equal += 1;
}

function recordMatrixDeletion(report) {
  report.candidate += 1;
  report.intentionally_deleted += 1;
}

export function buildMatrixMutations(documents, keys, nowMs = Date.now()) {
  const report = {
    scanned: documents.runs.length + documents.scenarios.length + documents.confirmations.length,
    candidate: 0,
    migrated: 0,
    intentionally_deleted: 0,
    old_decrypt_ok: 0,
    new_decrypt_ok: 0,
    plaintext_equal: 0,
    malformed: 0,
    write_failures: 0,
  };
  const mutations = [];
  const identities = new Map();
  const expiredRuns = new Set();

  for (const doc of documents.runs) {
    const data = doc.data();
    const identity = matrixIdentity(data);
    if (identity === undefined || doc.id !== identity.runId) {
      report.malformed += 1;
      continue;
    }
    identities.set(identity.runId, identity);
    if (data.status === 'finalized' && data.encryptedPromptContext === undefined) continue;
    if (data.status !== 'active' || data.encryptedPromptContext === undefined) {
      report.malformed += 1;
      continue;
    }
    if (isExpired(data.expiresAt, nowMs)) {
      expiredRuns.add(identity.runId);
      recordMatrixDeletion(report);
      mutations.push({ kind: 'delete', ref: doc.ref });
      continue;
    }
    try {
      const encryptedPromptContext = reencryptMatrixValue(
        data.encryptedPromptContext,
        matrixRunBinding(identity),
        keys.oldMatrix,
        keys.oldMatrixVersion,
        keys.newMatrix,
        keys.newMatrixVersion
      );
      recordMatrixMigration(report);
      mutations.push({ kind: 'update', ref: doc.ref, update: { encryptedPromptContext } });
    } catch {
      report.malformed += 1;
    }
  }

  const testRunIdentities = new Map();
  for (const doc of documents.testRuns) {
    const identity = matrixIdentity(doc.data());
    if (identity !== undefined && doc.id === identity.runId) {
      testRunIdentities.set(identity.runId, identity);
    }
  }

  for (const doc of documents.scenarios) {
    const data = doc.data();
    if (isExpired(data.expiresAt, nowMs)) {
      recordMatrixDeletion(report);
      mutations.push({ kind: 'delete', ref: doc.ref });
      continue;
    }
    const identity = identities.get(data.runId);
    if (identity === undefined || expiredRuns.has(data.runId)) {
      recordMatrixDeletion(report);
      mutations.push({ kind: 'delete', ref: doc.ref });
      continue;
    }
    if (
      data.userId !== identity.userId ||
      data.leaseFence !== identity.leaseFence ||
      typeof data.scenarioId !== 'string' ||
      data.encryptedEffectivePromptContext === undefined
    ) {
      report.malformed += 1;
      continue;
    }
    try {
      const encryptedEffectivePromptContext = reencryptMatrixValue(
        data.encryptedEffectivePromptContext,
        matrixScenarioBinding({ ...identity, scenarioId: data.scenarioId }),
        keys.oldMatrix,
        keys.oldMatrixVersion,
        keys.newMatrix,
        keys.newMatrixVersion
      );
      recordMatrixMigration(report);
      mutations.push({
        kind: 'update',
        ref: doc.ref,
        update: { encryptedEffectivePromptContext },
      });
    } catch {
      report.malformed += 1;
    }
  }

  for (const doc of documents.confirmations) {
    const data = doc.data();
    if (isExpired(data.expiresAt, nowMs)) {
      recordMatrixDeletion(report);
      mutations.push({ kind: 'delete', ref: doc.ref });
      continue;
    }
    const identity = identities.get(data.runId) ?? testRunIdentities.get(data.runId);
    if (identity === undefined) {
      recordMatrixDeletion(report);
      mutations.push({ kind: 'delete', ref: doc.ref });
      continue;
    }
    if (
      doc.id !== data.confirmationId ||
      data.leaseFence !== identity.leaseFence ||
      data.userBindingDigest !== sha256(identity.userId) ||
      data.encryptedToolArgs === undefined
    ) {
      report.malformed += 1;
      continue;
    }
    try {
      const encryptedToolArgs = reencryptMatrixValue(
        data.encryptedToolArgs,
        matrixConfirmationBinding(data, identity.userId),
        keys.oldMatrix,
        keys.oldMatrixVersion,
        keys.newMatrix,
        keys.newMatrixVersion
      );
      recordMatrixMigration(report);
      mutations.push({ kind: 'update', ref: doc.ref, update: { encryptedToolArgs } });
    } catch {
      report.malformed += 1;
    }
  }

  return { mutations, report };
}

async function commitBatch(db, mutations) {
  if (mutations.length === 0) return;
  const batch = db.batch();
  for (const mutation of mutations) {
    if (mutation.kind === 'delete') batch.delete(mutation.ref);
    else batch.update(mutation.ref, mutation.update);
  }
  await batch.commit();
}

export async function commitCutoverMutations(db, mutations) {
  const bulk = mutations.filter((mutation) => mutation.phase === 'bulk');
  const protectedMutations = mutations.filter((mutation) => mutation.phase === 'protected');
  if (bulk.length + protectedMutations.length !== mutations.length) {
    fail('migration mutation phase is invalid');
  }
  if (protectedMutations.length > 400) {
    fail('protected migration exceeds one atomic Firestore batch');
  }
  for (let index = 0; index < bulk.length; index += 400) {
    await commitBatch(db, bulk.slice(index, index + 400));
  }
  await commitBatch(db, protectedMutations);
}

async function buildPlan(db, keys) {
  const report = {
    application: {
      scanned: 0,
      candidate: 0,
      migrated: 0,
      intentionally_deleted: 0,
      retired_artifacts: 0,
      old_decrypt_ok: 0,
      new_decrypt_ok: 0,
      plaintext_equal: 0,
      malformed: 0,
      write_failures: 0,
    },
    tokens: {
      scanned: 0,
      candidate: 0,
      migrated: 0,
      intentionally_deleted: 0,
      old_decrypt_ok: 0,
      new_decrypt_ok: 0,
      plaintext_equal: 0,
      malformed: 0,
      write_failures: 0,
    },
    matrix: {
      scanned: 0,
      candidate: 0,
      migrated: 0,
      intentionally_deleted: 0,
      old_decrypt_ok: 0,
      new_decrypt_ok: 0,
      plaintext_equal: 0,
      malformed: 0,
      write_failures: 0,
    },
    workers: {
      tasks_scanned: 0,
      retired_tasks: 0,
      cancelled_nonterminal: 0,
      retired_defaults: 0,
      retired_statuses: 0,
      retired_values_remaining: 0,
    },
  };
  const mutations = [];

  const settings = await db.collection('user_settings').get();
  report.application.scanned = settings.size;
  for (const doc of settings.docs) {
    try {
      const transformed = transformUserSettings(doc.data(), keys.oldApp, keys.newApp);
      report.application.candidate += transformed.migrated + transformed.intentionallyDeleted;
      report.application.migrated += transformed.migrated;
      report.application.intentionally_deleted += transformed.intentionallyDeleted;
      report.application.retired_artifacts += transformed.retiredArtifacts;
      report.application.old_decrypt_ok += transformed.migrated;
      report.application.new_decrypt_ok += transformed.migrated;
      report.application.plaintext_equal += transformed.migrated;
      if (transformed.changed) {
        const update = {
          llmApiKeys: transformed.data.llmApiKeys,
          llmTestResults: transformed.data.llmTestResults,
        };
        if (transformed.deleteDefaultModel) update.defaultModel = FieldValue.delete();
        if (transformed.deleteFallbackModel) update.fallbackModel = FieldValue.delete();
        mutations.push({ kind: 'update', phase: 'protected', ref: doc.ref, update });
      }
    } catch {
      report.application.malformed += 1;
    }
  }

  const authTokens = await db.collection('auth_tokens').get();
  report.tokens.scanned += authTokens.size;
  for (const doc of authTokens.docs) {
    try {
      const plaintext = decryptTokenValue(doc.data().refreshToken, keys.oldToken);
      const replacement = encryptTokenValue(plaintext, keys.newToken);
      if (decryptTokenValue(replacement, keys.newToken) !== plaintext)
        fail('token plaintext mismatch');
      report.tokens.candidate += 1;
      report.tokens.migrated += 1;
      report.tokens.old_decrypt_ok += 1;
      report.tokens.new_decrypt_ok += 1;
      report.tokens.plaintext_equal += 1;
      mutations.push({
        kind: 'update',
        phase: 'protected',
        ref: doc.ref,
        update: { refreshToken: replacement },
      });
    } catch {
      report.tokens.malformed += 1;
    }
  }

  const oauth = await db.collection('oauth_connections').get();
  report.tokens.scanned += oauth.size;
  for (const doc of oauth.docs) {
    try {
      const data = doc.data();
      const update = {};
      for (const field of ['accessToken', 'refreshToken']) {
        const plaintext = decryptTokenValue(data[field], keys.oldToken);
        update[field] = encryptTokenValue(plaintext, keys.newToken);
        if (decryptTokenValue(update[field], keys.newToken) !== plaintext)
          fail('token plaintext mismatch');
        report.tokens.candidate += 1;
        report.tokens.migrated += 1;
        report.tokens.old_decrypt_ok += 1;
        report.tokens.new_decrypt_ok += 1;
        report.tokens.plaintext_equal += 1;
      }
      mutations.push({ kind: 'update', phase: 'protected', ref: doc.ref, update });
    } catch {
      report.tokens.malformed += 1;
    }
  }

  const workerSettings = await db.collection('code_worker_settings').get();
  report.tokens.scanned += workerSettings.size;
  for (const doc of workerSettings.docs) {
    try {
      const transformed = transformWorkerSettings(doc.data(), keys.oldToken, keys.newToken);
      const count = transformed.workers.length * 3;
      report.tokens.candidate += count;
      report.tokens.migrated += count;
      report.tokens.old_decrypt_ok += count;
      report.tokens.new_decrypt_ok += count;
      report.tokens.plaintext_equal += count;
      report.workers.retired_defaults += transformed.retiredDefaults.length;
      const update = { workers: transformed.workers };
      for (const field of transformed.retiredDefaults) update[field] = FieldValue.delete();
      mutations.push({ kind: 'update', phase: 'protected', ref: doc.ref, update });
    } catch {
      report.tokens.malformed += 1;
    }
  }

  const tasks = await db.collection('code_tasks').get();
  report.workers.tasks_scanned = tasks.size;
  for (const doc of tasks.docs) {
    const data = doc.data();
    if (!RETIRED_WORKER_TYPES.has(data.workerType)) continue;
    report.workers.retired_tasks += 1;
    const update = { workerType: 'openrouter-free' };
    if (NONTERMINAL_TASK_STATUSES.has(data.status)) {
      report.workers.cancelled_nonterminal += 1;
      update.status = 'cancelled';
    }
    mutations.push({ kind: 'update', phase: 'bulk', ref: doc.ref, update });
  }

  const statuses = await db.collection('code_task_system_statuses').get();
  for (const doc of statuses.docs) {
    if (RETIRED_WORKER_TYPES.has(doc.data().workerType)) {
      report.workers.retired_statuses += 1;
      mutations.push({ kind: 'delete', phase: 'bulk', ref: doc.ref });
    }
  }

  const runs = await db.collection('intex_agent_matrix_corpus_run_contexts').get();
  const scenarios = await db.collection('intex_agent_matrix_corpus_scenario_contexts').get();
  const confirmations = await db.collection('intex_agent_matrix_corpus_test_confirmations').get();
  const testRuns = await db.collection('intex_agent_test_runs').get();
  const matrixPlan = buildMatrixMutations(
    {
      runs: runs.docs,
      scenarios: scenarios.docs,
      confirmations: confirmations.docs,
      testRuns: testRuns.docs,
    },
    keys
  );
  report.matrix = matrixPlan.report;
  mutations.push(...matrixPlan.mutations.map((mutation) => ({ ...mutation, phase: 'protected' })));
  return { mutations, report };
}

function assertReport(report) {
  for (const domain of ['application', 'tokens', 'matrix']) {
    const current = report[domain];
    if (
      current.candidate !== current.migrated + current.intentionally_deleted ||
      current.old_decrypt_ok !== current.candidate - current.intentionally_deleted ||
      current.new_decrypt_ok !== current.migrated ||
      current.plaintext_equal !== current.migrated ||
      current.malformed !== 0 ||
      current.write_failures !== 0
    )
      fail(`${domain} migration gate failed`);
  }
}

async function verifyFinalState(db, keys, expected) {
  const check = await buildPlan(db, {
    oldApp: keys.newApp,
    newApp: keys.newApp,
    oldToken: keys.newToken,
    newToken: keys.newToken,
    oldMatrix: keys.newMatrix,
    newMatrix: keys.newMatrix,
    oldMatrixVersion: keys.newMatrixVersion,
    newMatrixVersion: keys.newMatrixVersion,
  });
  assertReport(check.report);
  const oldKeySuccessAfter = await countOldKeySuccesses(db, keys);
  if (
    check.report.application.intentionally_deleted !== 0 ||
    check.report.application.retired_artifacts !== 0 ||
    check.report.workers.retired_tasks !== 0 ||
    check.report.workers.retired_defaults !== 0 ||
    check.report.workers.retired_statuses !== 0 ||
    check.report.matrix.intentionally_deleted !== 0 ||
    check.report.application.migrated !== expected.application.migrated ||
    check.report.tokens.migrated !== expected.tokens.migrated ||
    check.report.matrix.migrated !== expected.matrix.migrated ||
    Object.values(oldKeySuccessAfter).some((count) => count !== 0)
  )
    fail('post-migration final-state gate failed');
  return { ...check.report, old_key_success_after: oldKeySuccessAfter, verified: true };
}

async function countOldKeySuccesses(db, keys) {
  const counts = { application: 0, tokens: 0, matrix_key_version: 0 };
  const settings = await db.collection('user_settings').get();
  for (const doc of settings.docs) {
    const encrypted = doc.data().llmApiKeys?.openrouter;
    if (encrypted === undefined) continue;
    try {
      decryptAppValue(encrypted, keys.oldApp);
      counts.application += 1;
    } catch {
      // Expected after migration.
    }
  }

  const encryptedTokenValues = [];
  const authTokens = await db.collection('auth_tokens').get();
  for (const doc of authTokens.docs) encryptedTokenValues.push(doc.data().refreshToken);
  const oauth = await db.collection('oauth_connections').get();
  for (const doc of oauth.docs) {
    encryptedTokenValues.push(doc.data().accessToken, doc.data().refreshToken);
  }
  const workerSettings = await db.collection('code_worker_settings').get();
  for (const doc of workerSettings.docs) {
    for (const worker of doc.data().workers ?? []) {
      encryptedTokenValues.push(
        worker.cfAccessClientId,
        worker.cfAccessClientSecret,
        worker.dispatchSigningSecret
      );
    }
  }
  for (const encrypted of encryptedTokenValues) {
    try {
      decryptTokenValue(encrypted, keys.oldToken);
      counts.tokens += 1;
    } catch {
      // Expected after migration.
    }
  }

  for (const [collection, field] of [
    ['intex_agent_matrix_corpus_run_contexts', 'encryptedPromptContext'],
    ['intex_agent_matrix_corpus_scenario_contexts', 'encryptedEffectivePromptContext'],
    ['intex_agent_matrix_corpus_test_confirmations', 'encryptedToolArgs'],
  ]) {
    const snapshot = await db.collection(collection).get();
    for (const doc of snapshot.docs) {
      if (doc.data()[field]?.keyVersion === keys.oldMatrixVersion) {
        counts.matrix_key_version += 1;
      }
    }
  }
  return counts;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const keys = {
    oldApp: readPrivateKeyFile(options['old-app-key-file'], 'old application key'),
    newApp: readPrivateKeyFile(options['new-app-key-file'], 'new application key'),
    oldToken: readPrivateKeyFile(options['old-token-key-file'], 'old token key'),
    newToken: readPrivateKeyFile(options['new-token-key-file'], 'new token key'),
    oldMatrix: readPrivateMatrixKeyFile(options['old-matrix-key-file'], 'old Matrix key'),
    newMatrix: readPrivateMatrixKeyFile(options['new-matrix-key-file'], 'new Matrix key'),
    oldMatrixVersion: options['old-matrix-key-version'],
    newMatrixVersion: options['new-matrix-key-version'],
  };
  if (
    keys.oldApp.equals(keys.newApp) ||
    keys.oldToken.equals(keys.newToken) ||
    keys.oldMatrix.equals(keys.newMatrix) ||
    keys.oldMatrixVersion === keys.newMatrixVersion
  ) {
    fail('old and new encryption keys and Matrix versions must differ');
  }
  for (const version of [keys.oldMatrixVersion, keys.newMatrixVersion]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/u.test(version)) {
      fail('Matrix key version is invalid');
    }
  }
  if (getApps().length === 0)
    initializeApp({ credential: applicationDefault(), projectId: options['project-id'] });
  const db = getFirestore();
  const plan = await buildPlan(db, keys);
  assertReport(plan.report);
  if (options.mode === 'apply') {
    await commitCutoverMutations(db, plan.mutations);
    const verified = await verifyFinalState(db, keys, plan.report);
    process.stdout.write(
      `${JSON.stringify({ mode: 'apply', plannedWrites: plan.mutations.length, report: plan.report, verification: verified }, null, 2)}\n`
    );
  } else {
    process.stdout.write(
      `${JSON.stringify({ mode: 'plan', plannedWrites: plan.mutations.length, report: plan.report }, null, 2)}\n`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(
      `Final cutover data migration failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
