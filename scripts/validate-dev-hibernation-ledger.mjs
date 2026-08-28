#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const usage =
  'Usage: validate-dev-hibernation-ledger --ledger <path> --schema <path> --expected-schema-sha256 <sha256> --expected-run-id <run-id> --evidence-root <path>';
export const FROZEN_SCHEMA_V1_SHA256 =
  '53033e271dd993f1ce7e81df3598ba51fcd9d87e837893e3b2d86994cdf2a245';
const runIdPattern = /^[0-9]{8}T[0-9]{6}Z-p[0-9a-f]{12}-b[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const utcTimestampPattern =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{3})?Z$/u;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const serviceAccountPattern =
  /^[a-z0-9][a-z0-9._-]*@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/u;
const rawUserHomePattern = /\/(?:Users|home)\/[^/\s"'<>]+/u;
const genericIdentityMarkers = [
  'notapplicable',
  'tbd',
  'tobedetermined',
  'pending',
  'awaitinginvestigation',
  'placeholder',
  'unknown',
  'null',
  'none',
  'todo',
];
const genericNaMarkerPattern = /(?:^|[^\p{L}\p{N}])n[^\p{L}\p{N}]+a(?:$|[^\p{L}\p{N}])/iu;
const sourceRevisionReasonCodes = new Set([
  'external-provider-observation',
  'live-runtime-observation',
  'operator-authorization-observation',
  'non-repository-artifact',
]);
const externalObjectReasonCodes = new Set([
  'repository-observation',
  'live-runtime-observation',
  'local-artifact-observation',
  'test-validation-observation',
  'non-provider-observation',
]);
const authorizationPattern = /\b(?:bearer|basic)\s+[A-Za-z0-9+/_.=-]{4,}/iu;
const urlUserInfoPattern = /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/iu;
const urlSensitiveQueryPattern =
  /\bhttps?:\/\/[^\s]*[?&](?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|passwd|auth(?:orization)?)=[^&#\s]+/iu;
const phoneLiteralPattern =
  /(?:^|[^\p{L}\p{N}])(?:\+[1-9][0-9]{0,2}[\s().-]*)?(?:[0-9][\s().-]*){9,15}(?:$|[^\p{L}\p{N}])/u;
const secretPrefixPattern =
  /\b(?:gh[pousr]_|github_pat_|sk-(?:live-|test-)?|xox[baprs]-|AIza|AKIA|ya29\.)[A-Za-z0-9._-]{8,}/u;
const secretAssignmentPattern =
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|client[_-]?secret|authorization)\s*[:=]\s*[^\s,;]+/iu;

/**
 * @typedef {{ line: number, value: unknown }} ParsedLedgerRow
 * @typedef {{
 *   expectedRunId: string,
 *   evidenceRoot: string,
 *   sourceLines?: number[],
 *   artifactLoader?: (evidenceRoot: string, relativePath: string) => Uint8Array,
 * }} LedgerValidationOptions
 */

/**
 * Parse append-only JSONL without including malformed row contents in errors.
 *
 * @param {string} content
 * @returns {ParsedLedgerRow[]}
 */
export function parseLedgerJsonl(content) {
  const rows = [];
  for (const [index, sourceLine] of content.split('\n').entries()) {
    if (sourceLine.trim().length === 0) continue;
    try {
      rows.push({ line: index + 1, value: JSON.parse(sourceLine) });
    } catch {
      throw new Error(`Invalid JSON on ledger line ${String(index + 1)}`);
    }
  }
  return rows;
}

/**
 * Validate evidence rows against the frozen schema, run identity, artifact hashes, chronology,
 * and privacy invariants. Errors contain field paths only, never field values.
 *
 * @param {unknown[]} rows
 * @param {unknown} schema
 * @param {LedgerValidationOptions} options
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEvidenceRows(rows, schema, options) {
  assertValidationOptions(options, rows);
  if (rows.length === 0) {
    return { valid: false, errors: ['ledger: must contain at least one row'] };
  }

  const validate = compileLedgerSchema(schema);
  const errors = [];
  let previousBootstrapObservedAt;
  let previousAppendedAt;

  rows.forEach((row, index) => {
    const sourceLine = options.sourceLines?.[index] ?? index + 1;
    if (!validate(row)) {
      for (const error of validate.errors ?? []) {
        errors.push(formatSchemaError(sourceLine, error));
      }
    }
    errors.push(...validateRowSemantics(row, sourceLine, options));

    if (
      isRecord(row) &&
      row.milestone === 'M0' &&
      row.stepId === 'M0.1' &&
      typeof row.observedAt === 'string' &&
      isValidUtcTimestamp(row.observedAt)
    ) {
      if (
        previousBootstrapObservedAt !== undefined &&
        Date.parse(row.observedAt) < Date.parse(previousBootstrapObservedAt)
      ) {
        errors.push(
          `ledger line ${String(sourceLine)}/observedAt: must be monotonic across ledger rows`
        );
      }
      previousBootstrapObservedAt = row.observedAt;
    }

    if (
      isRecord(row) &&
      typeof row.appendedAt === 'string' &&
      isValidUtcTimestamp(row.appendedAt)
    ) {
      if (
        previousAppendedAt !== undefined &&
        Date.parse(row.appendedAt) < Date.parse(previousAppendedAt)
      ) {
        errors.push(
          `ledger line ${String(sourceLine)}/appendedAt: must be monotonic across ledger rows`
        );
      }
      previousAppendedAt = row.appendedAt;
    }
  });

  const uniqueErrors = [...new Set(errors)];
  return { valid: uniqueErrors.length === 0, errors: uniqueErrors };
}

/**
 * Run the exact-file validator CLI.
 *
 * @param {string[]} argv
 * @param {(line: string) => void} [writeLine]
 * @returns {number}
 */
export function runLedgerValidatorCli(
  argv,
  writeLine = (line) => process.stdout.write(`${line}\n`)
) {
  const options = parseArguments(argv);
  const schemaBytes = readBinaryFile(options.schema, 'schema');
  const schemaSha256 = hashBytes(schemaBytes);

  if (schemaSha256 !== options.expectedSchemaSha256 || schemaSha256 !== FROZEN_SCHEMA_V1_SHA256) {
    const errors = [];
    if (schemaSha256 !== options.expectedSchemaSha256) {
      errors.push('schemaSha256: does not match expected frozen schema');
    }
    if (schemaSha256 !== FROZEN_SCHEMA_V1_SHA256) {
      errors.push('schemaSha256: does not match embedded v1 trust root');
    }
    writeLine(
      JSON.stringify({
        valid: false,
        rowCount: 0,
        schemaSha256,
        runId: options.expectedRunId,
        errors,
      })
    );
    return 1;
  }

  const schema = parseSchemaBytes(schemaBytes);
  const parsedRows = parseLedgerJsonl(readTextFile(options.ledger, 'ledger'));
  const result = validateEvidenceRows(
    parsedRows.map((entry) => entry.value),
    schema,
    {
      expectedRunId: options.expectedRunId,
      evidenceRoot: options.evidenceRoot,
      sourceLines: parsedRows.map((entry) => entry.line),
    }
  );

  writeLine(
    JSON.stringify({
      valid: result.valid,
      rowCount: parsedRows.length,
      schemaSha256,
      runId: options.expectedRunId,
      errors: result.errors,
    })
  );
  return result.valid ? 0 : 1;
}

function assertValidationOptions(options, rows) {
  if (
    !isRecord(options) ||
    typeof options.expectedRunId !== 'string' ||
    !runIdPattern.test(options.expectedRunId) ||
    typeof options.evidenceRoot !== 'string' ||
    options.evidenceRoot.length === 0 ||
    (options.artifactLoader !== undefined && typeof options.artifactLoader !== 'function') ||
    (options.sourceLines !== undefined &&
      (!Array.isArray(options.sourceLines) ||
        options.sourceLines.length !== rows.length ||
        options.sourceLines.some((line) => !Number.isInteger(line) || line < 1)))
  ) {
    throw new Error('Ledger validation options are invalid');
  }
}

function compileLedgerSchema(schema) {
  const ajv = new Ajv({ allErrors: true, logger: false, strict: true });
  try {
    if (ajv.validateSchema(schema) !== true) {
      throw new Error('Ledger schema is invalid');
    }
    return ajv.compile(schema);
  } catch {
    throw new Error('Ledger schema is invalid');
  }
}

function validateRowSemantics(row, sourceLine, options) {
  const errors = [];
  if (!isRecord(row)) return errors;
  const prefix = `ledger line ${String(sourceLine)}`;

  if (row.runId !== options.expectedRunId) {
    errors.push(`${prefix}/runId: must equal the expected frozen RUN_ID`);
  }

  for (const timestampKey of ['observedAt', 'appendedAt']) {
    const timestamp = row[timestampKey];
    if (
      typeof timestamp === 'string' &&
      utcTimestampPattern.test(timestamp) &&
      !isValidUtcTimestamp(timestamp)
    ) {
      errors.push(`${prefix}/${timestampKey}: must be a real UTC calendar timestamp`);
    }
  }

  if (
    typeof row.observedAt === 'string' &&
    typeof row.appendedAt === 'string' &&
    isValidUtcTimestamp(row.observedAt) &&
    isValidUtcTimestamp(row.appendedAt) &&
    Date.parse(row.observedAt) > Date.parse(row.appendedAt)
  ) {
    errors.push(`${prefix}/appendedAt: must not precede observedAt`);
  }

  if (
    typeof row.milestone === 'string' &&
    typeof row.stepId === 'string' &&
    !row.stepId.startsWith(`${row.milestone}.`)
  ) {
    errors.push(`${prefix}/stepId: must belong to milestone`);
  }

  validateIdentityArrayReason(
    row,
    prefix,
    'sourceRevisions',
    'sourceRevisionsNotApplicableReason',
    errors
  );
  validateIdentityArrayReason(
    row,
    prefix,
    'externalObjectIds',
    'externalObjectIdsNotApplicableReason',
    errors
  );

  if (Array.isArray(row.externalObjectIds)) {
    row.externalObjectIds.forEach((externalObject, index) => {
      if (
        isRecord(externalObject) &&
        typeof externalObject.id === 'string' &&
        isPlaceholderId(externalObject.id)
      ) {
        errors.push(
          `${prefix}/externalObjectIds/${String(index)}/id: placeholder IDs are forbidden`
        );
      }
    });
  }

  validateArtifact(row, prefix, options, errors);
  collectPrivacyErrors(row, row, prefix, [], errors);
  return errors;
}

function validateIdentityArrayReason(row, prefix, arrayKey, reasonKey, errors) {
  const values = row[arrayKey];
  const reason = row[reasonKey];
  if (Array.isArray(values) && values.length === 0) {
    const allowedCodes =
      arrayKey === 'sourceRevisions' ? sourceRevisionReasonCodes : externalObjectReasonCodes;
    const targetSystem = row.targetSystem;
    const validReason =
      typeof reason === 'string' &&
      typeof targetSystem === 'string' &&
      [...allowedCodes].some(
        (reasonCode) => reason === `reasonCode=${reasonCode};target=${targetSystem}`
      );
    if (!validReason) {
      errors.push(
        `${prefix}/${reasonKey}: must use an allow-listed structured reason for exact targetSystem`
      );
    }
  }
}

function validateArtifact(row, prefix, options, errors) {
  if (typeof row.artifactRelativePath !== 'string' || typeof row.artifactSha256 !== 'string') {
    return;
  }

  if (!isCanonicalArtifactPath(row.artifactRelativePath)) {
    errors.push(`${prefix}/artifactRelativePath: must be a canonical relative path`);
    return;
  }

  let content;
  try {
    content = (options.artifactLoader ?? loadContainedRegularFile)(
      options.evidenceRoot,
      row.artifactRelativePath
    );
  } catch {
    errors.push(`${prefix}/artifactRelativePath: must identify a contained regular file`);
    return;
  }

  if (hashBytes(content) !== row.artifactSha256) {
    errors.push(`${prefix}/artifactSha256: does not match the exact artifact bytes`);
  }
}

function isCanonicalArtifactPath(relativePath) {
  if (
    relativePath.length === 0 ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    path.posix.normalize(relativePath) !== relativePath
  ) {
    return false;
  }
  return relativePath
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function loadContainedRegularFile(evidenceRoot, relativePath) {
  let descriptor;
  try {
    const root = realpathSync(evidenceRoot);
    if (!statSync(root).isDirectory()) throw new Error('invalid evidence root');
    const candidate = path.resolve(root, relativePath);
    if (!isContainedPath(root, candidate)) throw new Error('artifact escapes evidence root');
    const resolvedCandidate = realpathSync(candidate);
    if (!isContainedPath(root, resolvedCandidate))
      throw new Error('artifact escapes evidence root');
    descriptor = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) throw new Error('artifact is not a regular file');
    return readFileSync(descriptor);
  } catch {
    throw new Error('Evidence artifact is unavailable');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isContainedPath(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath !== '' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== '..' &&
    !path.isAbsolute(relativePath)
  );
}

function collectPrivacyErrors(root, value, prefix, fieldPath, errors) {
  if (typeof value === 'string') {
    const pathLabel = fieldPath.map(String).join('/');
    if (rawUserHomePattern.test(value)) {
      errors.push(`${prefix}/${pathLabel}: raw user-home paths are forbidden`);
    }
    for (const email of value.match(emailPattern) ?? []) {
      if (!isAllowedServiceAccountPrincipal(root, fieldPath, value, email)) {
        errors.push(`${prefix}/${pathLabel}: human or untyped email is forbidden`);
      }
    }
    if (containsHighConfidenceSecret(value)) {
      errors.push(`${prefix}/${pathLabel}: secret or personal-data literal is forbidden`);
    }
    if (
      phoneLiteralPattern.test(value) &&
      !isAllowedTypedNumericExternalId(root, fieldPath, value)
    ) {
      errors.push(`${prefix}/${pathLabel}: secret or personal-data literal is forbidden`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectPrivacyErrors(root, entry, prefix, [...fieldPath, index], errors)
    );
    return;
  }

  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      collectPrivacyErrors(root, entry, prefix, [...fieldPath, key], errors);
    }
  }
}

function containsHighConfidenceSecret(value) {
  return (
    authorizationPattern.test(value) ||
    urlUserInfoPattern.test(value) ||
    urlSensitiveQueryPattern.test(value) ||
    secretPrefixPattern.test(value) ||
    secretAssignmentPattern.test(value)
  );
}

function isAllowedTypedNumericExternalId(root, fieldPath, value) {
  if (
    fieldPath.length !== 3 ||
    fieldPath[0] !== 'externalObjectIds' ||
    typeof fieldPath[1] !== 'number' ||
    fieldPath[2] !== 'id' ||
    !isRecord(root) ||
    !Array.isArray(root.externalObjectIds)
  ) {
    return false;
  }
  const externalObject = root.externalObjectIds[fieldPath[1]];
  if (
    !isRecord(externalObject) ||
    externalObject.idKind !== 'provider-native' ||
    !/^[0-9]+$/u.test(value)
  ) {
    return false;
  }
  return (
    (externalObject.provider === 'meta' && externalObject.objectType === 'phone-number-id') ||
    (externalObject.provider === 'github' &&
      [
        'pull-request',
        'repository',
        'installation',
        'workflow-run',
        'check-run',
        'job',
        'hook',
      ].includes(String(externalObject.objectType)))
  );
}

function isAllowedServiceAccountPrincipal(root, fieldPath, value, email) {
  if (
    fieldPath.length !== 3 ||
    fieldPath[0] !== 'externalObjectIds' ||
    typeof fieldPath[1] !== 'number' ||
    fieldPath[2] !== 'id' ||
    value !== email ||
    !serviceAccountPattern.test(email) ||
    !isRecord(root) ||
    !Array.isArray(root.externalObjectIds)
  ) {
    return false;
  }

  const externalObject = root.externalObjectIds[fieldPath[1]];
  return (
    isRecord(externalObject) &&
    externalObject.provider === 'gcp' &&
    externalObject.objectType === 'service-account-principal' &&
    externalObject.idKind === 'provider-native'
  );
}

function isPlaceholderId(value) {
  const normalized = canonicalizeGenericIdentity(value);
  return normalized.length === 0 || hasGenericIdentityMarker(value, normalized);
}

function hasGenericIdentityMarker(value, canonical) {
  return (
    canonical === 'na' ||
    genericNaMarkerPattern.test(value.normalize('NFKC')) ||
    genericIdentityMarkers.some((marker) => canonical.includes(marker))
  );
}

function canonicalizeGenericIdentity(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function isValidUtcTimestamp(value) {
  if (!utcTimestampPattern.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const normalized = value.includes('.') ? value : value.replace(/Z$/u, '.000Z');
  return parsed.toISOString() === normalized;
}

function formatSchemaError(sourceLine, error) {
  const missingProperty =
    error.keyword === 'required' && typeof error.params?.missingProperty === 'string'
      ? `/${error.params.missingProperty}`
      : '';
  const location = `${error.instancePath}${missingProperty}` || '/';
  return `ledger line ${String(sourceLine)}${location}: ${error.message ?? 'schema validation failed'}`;
}

function parseArguments(argv) {
  const allowedOptions = new Set([
    'ledger',
    'schema',
    'expected-schema-sha256',
    'expected-run-id',
    'evidence-root',
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      typeof key !== 'string' ||
      !key.startsWith('--') ||
      typeof value !== 'string' ||
      value.startsWith('--')
    ) {
      throw new Error(usage);
    }
    const name = key.slice(2);
    if (!allowedOptions.has(name) || Object.hasOwn(options, name)) throw new Error(usage);
    options[name] = value;
  }

  if (
    typeof options.ledger !== 'string' ||
    typeof options.schema !== 'string' ||
    typeof options['expected-schema-sha256'] !== 'string' ||
    !sha256Pattern.test(options['expected-schema-sha256']) ||
    typeof options['expected-run-id'] !== 'string' ||
    !runIdPattern.test(options['expected-run-id']) ||
    typeof options['evidence-root'] !== 'string' ||
    options['evidence-root'].length === 0
  ) {
    throw new Error(usage);
  }

  return {
    ledger: options.ledger,
    schema: options.schema,
    expectedSchemaSha256: options['expected-schema-sha256'],
    expectedRunId: options['expected-run-id'],
    evidenceRoot: options['evidence-root'],
  };
}

function parseSchemaBytes(content) {
  try {
    return JSON.parse(Buffer.from(content).toString('utf8'));
  } catch {
    throw new Error('Ledger schema JSON is invalid');
  }
}

function readBinaryFile(filePath, label) {
  try {
    return readFileSync(filePath);
  } catch {
    throw new Error(`Unable to read ${label} file`);
  }
}

function readTextFile(filePath, label) {
  return Buffer.from(readBinaryFile(filePath, label)).toString('utf8');
}

function hashBytes(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runLedgerValidatorCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Ledger validation failed'}\n`
    );
    process.exitCode = 1;
  }
}
