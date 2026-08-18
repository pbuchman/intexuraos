#!/usr/bin/env node

import { createPrivateKey } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.pnpm-store',
  '.terraform',
  'coverage',
  'dist',
  'node_modules',
]);

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u;
const SERVICE_ACCOUNT_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PACKAGE_PAYLOAD_KEYS = ['env', 'environment', 'files', 'schemaVersion'];

function walk(root, current, files) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
        walk(root, resolve(current, entry.name), files);
      }
      continue;
    }
    if (entry.isFile()) files.push(resolve(current, entry.name));
  }
}

export function scanCredentialFiles({ root = resolve(import.meta.dirname, '..') } = {}) {
  const absoluteRoot = resolve(root);
  const files = [];
  const violations = [];
  walk(absoluteRoot, absoluteRoot, files);
  files.sort();

  for (const path of files) {
    const name = relative(absoluteRoot, path).replaceAll('\\', '/');
    const mode = lstatSync(path).mode;
    if ((mode & 0o170000) !== 0o100000) continue;

    let content;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }

    let jsonValue;
    try {
      jsonValue = JSON.parse(content);
    } catch {
      jsonValue = undefined;
    }

    if (isSecretPackagePayload(jsonValue)) {
      violations.push({ path: name, reason: 'secret-package-payload' });
      continue;
    }

    const nestedCredentialReason = inspectJsonCredentialMaterial(jsonValue);
    if (nestedCredentialReason !== undefined) {
      violations.push({ path: name, reason: nestedCredentialReason });
      continue;
    }

    if (/\.(?:key|pem)$/u.test(name) && isPrivateKeyPem(content)) {
      violations.push({ path: name, reason: 'private-key-material' });
    }
  }

  return { ok: violations.length === 0, violations };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isSecretPackagePayload(value) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, PACKAGE_PAYLOAD_KEYS) ||
    value.schemaVersion !== 1 ||
    !['dev', 'prod'].includes(value.environment) ||
    !isPlainObject(value.env) ||
    !isPlainObject(value.files)
  ) {
    return false;
  }
  const envEntries = Object.entries(value.env);
  if (envEntries.length === 0) return false;
  if (
    envEntries.some(
      ([key, member]) => !/^INTEXURAOS_[A-Z0-9_]+$/u.test(key) || typeof member !== 'string'
    )
  ) {
    return false;
  }
  return Object.values(value.files).every((member) => typeof member === 'string');
}

function isServiceAccount(value) {
  return (
    isPlainObject(value) &&
    value.type === 'service_account' &&
    typeof value.client_email === 'string' &&
    SERVICE_ACCOUNT_EMAIL_PATTERN.test(value.client_email) &&
    typeof value.private_key === 'string' &&
    isPrivateKeyPem(value.private_key)
  );
}

function isPrivateKeyPem(value) {
  if (typeof value !== 'string' || !PRIVATE_KEY_PATTERN.test(value)) return false;
  try {
    createPrivateKey(value);
    return true;
  } catch {
    return false;
  }
}

function decodeCanonicalBase64(value) {
  if (
    typeof value !== 'string' ||
    value.length < 64 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : undefined;
}

function inspectJsonCredentialMaterial(value) {
  if (isServiceAccount(value)) return 'service-account-json';
  if (Array.isArray(value)) {
    for (const member of value) {
      const reason = inspectJsonCredentialMaterial(member);
      if (reason !== undefined) return reason;
    }
    return undefined;
  }
  if (isPlainObject(value)) {
    for (const member of Object.values(value)) {
      const reason = inspectJsonCredentialMaterial(member);
      if (reason !== undefined) return reason;
    }
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  if (isPrivateKeyPem(value)) return 'private-key-material';
  const decoded = decodeCanonicalBase64(value);
  if (decoded === undefined) return undefined;
  const decodedText = decoded.toString('utf8');
  if (isPrivateKeyPem(decodedText)) return 'private-key-material';
  try {
    const nested = JSON.parse(decodedText);
    return inspectJsonCredentialMaterial(nested);
  } catch {
    return undefined;
  }
}

function main() {
  const rootArgument = process.argv[2];
  const root =
    rootArgument === undefined ? resolve(import.meta.dirname, '..') : resolve(rootArgument);
  if (!existsSync(root)) {
    process.stderr.write('Credential scan root does not exist.\n');
    process.exitCode = 1;
    return;
  }

  const result = scanCredentialFiles({ root });
  if (!result.ok) {
    process.stderr.write('Forbidden credential material detected:\n');
    for (const violation of result.violations) {
      process.stderr.write(`- ${violation.path}: ${violation.reason}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Credential file guard passed.\n');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
