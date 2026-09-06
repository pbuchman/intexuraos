#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_CUTOFF_DATE,
  FISHING_GROUP_KEY,
  LAST_MEANINGFUL_LEGACY_DATE,
  hashArchiveDocuments,
  hashLegacyDocuments,
} from './fishing-group-migration.mjs';

const MAX_DOCUMENTS = 1_000;
const MAX_HTTP_RESPONSE_CHARS = 64 * 1024;
const CUTOVER_CALLER_ROLE = 'message_digest_cutover_verifier';

export async function resolveFishingMigrationBinding(options) {
  validateOptions(options);
  const firestore = options.firestore ?? createFirestore(options.projectId);
  const groupTitle = readLegacyGroupTitlePrefix(options.previousReleaseDir);
  const normalizedGroupTitle = normalizeComparableGroupName(groupTitle);
  if (normalizedGroupTitle === '') throw safeError('MIGRATION_BINDING_LEGACY_CONFIG_INVALID');
  const ownershipSnapshot = await firestore
    .collection('notification_daily_digests')
    .where('groupKey', '==', FISHING_GROUP_KEY)
    .limit(MAX_DOCUMENTS + 1)
    .get();
  assertBounded(ownershipSnapshot.docs);
  const userIds = new Set(
    ownershipSnapshot.docs.flatMap((document) => {
      const value = document.data()?.userId;
      return typeof value === 'string' && value.trim() !== '' ? [value] : [];
    })
  );
  if (userIds.size !== 1) throw safeError('MIGRATION_BINDING_OWNER_NOT_UNIQUE');
  const userId = [...userIds][0];
  const [digests, states] = await Promise.all([
    readOwnedArchive(firestore, 'notification_daily_digests', userId),
    readOwnedArchive(firestore, 'notification_group_states', userId),
  ]);
  const auditedDigests = digests.filter(
    (document) => typeof document.data.date === 'string' && document.data.date <= AUDIT_CUTOFF_DATE
  );
  const frozenStates = states.filter(
    (document) =>
      typeof document.data.date === 'string' && document.data.date <= LAST_MEANINGFUL_LEGACY_DATE
  );
  const checkpointStates = frozenStates.filter(
    (document) => document.data.date === LAST_MEANINGFUL_LEGACY_DATE
  );
  if (auditedDigests.length === 0 || frozenStates.length === 0 || checkpointStates.length !== 1) {
    throw safeError('MIGRATION_BINDING_LEGACY_EMPTY');
  }
  const candidate = await resolveWhatsAppMigrationBinding({
    userId,
    expectedDisplayName: groupTitle,
    baseUrl: options.whatsappServiceUrl,
    internalAuthToken: options.internalAuthToken,
    fetchImplementation: options.fetchImplementation ?? globalThis.fetch,
  });
  return {
    INTEXURAOS_GCP_PROJECT_ID: options.projectId,
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_USER_ID: userId,
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_ACCOUNT_ID: candidate.sourceAccountId,
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_GENERATION_ID: candidate.generationId,
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_CHAT_ID: candidate.chatId,
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_GROUP_NAME: candidate.displayName,
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_DIGEST_HASH: hashLegacyDocuments(auditedDigests),
    INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_STATE_HASH: hashArchiveDocuments(frozenStates),
  };
}

async function resolveWhatsAppMigrationBinding(input) {
  let response;
  try {
    response = await input.fetchImplementation(
      `${normalizeBaseUrl(input.baseUrl)}/internal/whatsapp/private/digest-source/migration-binding/resolve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': input.internalAuthToken,
          'X-Internal-Caller-Role': CUTOVER_CALLER_ROLE,
        },
        body: JSON.stringify({
          userId: input.userId,
          expectedDisplayName: input.expectedDisplayName,
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );
  } catch {
    throw safeError('MIGRATION_BINDING_WHATSAPP_LOOKUP_FAILED');
  }
  if (!isRecord(response) || typeof response.text !== 'function') {
    throw safeError('MIGRATION_BINDING_WHATSAPP_LOOKUP_FAILED');
  }
  if (response.status === 404) throw safeError('MIGRATION_BINDING_ACCOUNT_INVALID');
  if (response.status === 409) throw safeError('MIGRATION_BINDING_CHAT_NOT_UNIQUE');
  const contentType = response.headers?.get?.('content-type');
  if (
    response.ok !== true ||
    typeof contentType !== 'string' ||
    contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    throw safeError('MIGRATION_BINDING_WHATSAPP_LOOKUP_FAILED');
  }
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_RESPONSE_CHARS) {
    throw safeError('MIGRATION_BINDING_WHATSAPP_LOOKUP_FAILED');
  }
  let envelope;
  try {
    const text = await response.text();
    if (text.length > MAX_HTTP_RESPONSE_CHARS) {
      throw safeError('MIGRATION_BINDING_WHATSAPP_LOOKUP_FAILED');
    }
    envelope = JSON.parse(text);
  } catch {
    throw safeError('MIGRATION_BINDING_WHATSAPP_LOOKUP_FAILED');
  }
  const candidate = envelope?.data;
  if (
    !isRecord(envelope) ||
    envelope.success !== true ||
    !isRecord(candidate) ||
    Object.keys(candidate).sort().join(',') !== 'chatId,displayName,generationId,sourceAccountId' ||
    typeof candidate.sourceAccountId !== 'string' ||
    candidate.sourceAccountId === '' ||
    typeof candidate.generationId !== 'string' ||
    candidate.generationId === '' ||
    typeof candidate.chatId !== 'string' ||
    candidate.chatId === '' ||
    typeof candidate.displayName !== 'string' ||
    normalizeComparableGroupName(candidate.displayName) !==
      normalizeComparableGroupName(input.expectedDisplayName)
  ) {
    throw safeError('MIGRATION_BINDING_WHATSAPP_LOOKUP_FAILED');
  }
  return candidate;
}

export function writeProtectedBindingFile(path, binding) {
  if (typeof path !== 'string' || !isAbsolute(path) || !isRecord(binding)) {
    throw safeError('MIGRATION_BINDING_OUTPUT_INVALID');
  }
  const lines = Object.entries(binding).map(([name, value]) => {
    if (!/^INTEXURAOS_[A-Z0-9_]+$/u.test(name) || typeof value !== 'string' || value === '') {
      throw safeError('MIGRATION_BINDING_OUTPUT_INVALID');
    }
    return `${name}=${dotenvQuote(value)}`;
  });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${lines.join('\n')}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  const directoryDescriptor = openSync(dirname(path), 'r');
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function createFirestore(projectId) {
  const appName = `message-digest-binding-${createHash('sha256')
    .update(projectId, 'utf8')
    .digest('hex')
    .slice(0, 12)}`;
  const app =
    getApps().find((candidate) => candidate.name === appName) ??
    initializeApp({ credential: applicationDefault(), projectId }, appName);
  return getFirestore(app);
}

async function readOwnedArchive(firestore, collection, userId) {
  const snapshot = await firestore
    .collection(collection)
    .where('userId', '==', userId)
    .where('groupKey', '==', FISHING_GROUP_KEY)
    .limit(MAX_DOCUMENTS + 1)
    .get();
  assertBounded(snapshot.docs);
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

function readLegacyGroupTitlePrefix(previousReleaseDir) {
  const path = resolve(
    previousReleaseDir,
    'apps/mobile-notifications-service/src/domain/digestSubscriptions.ts'
  );
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    throw safeError('MIGRATION_BINDING_LEGACY_CONFIG_MISSING');
  }
  const escapedKey = FISHING_GROUP_KEY.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const expression = new RegExp(
    String.raw`\{[\s\S]{0,2000}?groupKey:\s*['"]${escapedKey}['"][\s\S]{0,1000}?groupTitlePrefix:\s*['"]([^'"]{1,512})['"][\s\S]{0,1000}?\}`,
    'gu'
  );
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw safeError('MIGRATION_BINDING_LEGACY_CONFIG_INVALID');
  }
  return matches[0][1].trim();
}

function normalizeComparableGroupName(value) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pl-PL')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/u, '');
}

function validateOptions(options) {
  if (
    !isRecord(options) ||
    typeof options.projectId !== 'string' ||
    options.projectId.trim() === '' ||
    typeof options.previousReleaseDir !== 'string' ||
    !isAbsolute(options.previousReleaseDir) ||
    typeof options.whatsappServiceUrl !== 'string' ||
    options.whatsappServiceUrl.trim() === '' ||
    typeof options.internalAuthToken !== 'string' ||
    options.internalAuthToken.trim() === '' ||
    (options.fetchImplementation !== undefined && typeof options.fetchImplementation !== 'function')
  ) {
    throw safeError('MIGRATION_BINDING_CONFIG_INVALID');
  }
}

function assertBounded(documents) {
  if (!Array.isArray(documents) || documents.length > MAX_DOCUMENTS) {
    throw safeError('MIGRATION_BINDING_QUERY_TOO_LARGE');
  }
}

function dotenvQuote(value) {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')}"`;
}

function safeError(code) {
  return new Error(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw safeError('MIGRATION_BINDING_ARGUMENTS_INVALID');
    }
    options[name.slice(2)] = value;
  }
  return options;
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath !== null && entryPath === fileURLToPath(import.meta.url)) {
  try {
    const argumentsMap = parseArguments(process.argv.slice(2));
    const projectId = argumentsMap['project-id'];
    const previousReleaseDir = argumentsMap['previous-release'];
    const output = argumentsMap.output;
    if (projectId === undefined || previousReleaseDir === undefined || output === undefined) {
      throw safeError('MIGRATION_BINDING_ARGUMENTS_INVALID');
    }
    const binding = await resolveFishingMigrationBinding({
      projectId,
      previousReleaseDir,
      whatsappServiceUrl: process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'],
      internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
    });
    writeProtectedBindingFile(resolve(output), binding);
    process.stdout.write('{"ok":true,"candidateCount":1}\n');
  } catch (error) {
    const code = error instanceof Error ? error.message : 'MIGRATION_BINDING_RESOLUTION_FAILED';
    process.stderr.write(
      `${/^[A-Z0-9_]+$/u.test(code) ? code : 'MIGRATION_BINDING_RESOLUTION_FAILED'}\n`
    );
    process.exitCode = 1;
  }
}
