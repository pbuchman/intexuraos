import { execFileSync } from 'node:child_process';
import { createHmac, createPrivateKey, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = resolve(
  MODULE_DIRECTORY,
  '..',
  '..',
  'config',
  'environments',
  'secret-packages.json'
);
const ENVIRONMENTS = ['dev', 'prod'];
const ENVIRONMENT_SET = new Set(ENVIRONMENTS);
const MANIFEST_KEYS = ['nativeSecretNames', 'packages', 'schemaVersion'];
const PACKAGE_KEYS = ['envNames', 'files', 'secretId', 'stableVersion'];
const PAYLOAD_KEYS = ['env', 'environment', 'files', 'schemaVersion'];
const ENV_NAME_PATTERN = /^INTEXURAOS_[A-Z0-9_]+$/u;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const NUMERIC_VERSION_PATTERN = /^[1-9]\d*$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_PAYLOAD_BYTES = 65_536;
const FIREBASE_API_KEY = 'INTEXURAOS_FIREBASE_API_KEY';
const FIREBASE_API_KEY_PATTERN = /^AIza[A-Za-z0-9_-]{35}$/u;
const SERVICE_ACCOUNT_PROJECT_ID = 'intexuraos-dev-pbuchman';
const NATIVE_SECRET_NAMES = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_SPEECHMATICS_APP_API_KEY',
];
const PACKAGE_SECRET_IDS = {
  dev: 'INTEXURAOS_SECRET_PACKAGE_DEV',
  prod: 'INTEXURAOS_SECRET_PACKAGE_PROD',
};
const PACKAGE_FILE_NAMES = {
  dev: ['githubAppPrivateKeyPemBase64'],
  prod: [
    'cloudflareDnsApiTokenBase64',
    'runtimeGcpServiceAccountJsonBase64',
    'tlsPrivateKeyPemBase64',
  ],
};
const RENDERED_FILE_NAMES = {
  cloudflareDnsApiTokenBase64: 'cloudflare-dns-api-token',
  githubAppPrivateKeyPemBase64: 'github-app-private-key.pem',
  runtimeGcpServiceAccountJsonBase64: 'runtime-gcp-service-account.json',
  tlsPrivateKeyPemBase64: 'tls-private-key.pem',
};
const SERVICE_ACCOUNT_KEYS = [
  'auth_provider_x509_cert_url',
  'auth_uri',
  'client_email',
  'client_id',
  'client_x509_cert_url',
  'private_key',
  'private_key_id',
  'project_id',
  'token_uri',
  'type',
  'universe_domain',
];

let crc32cTable;

/**
 * Load and validate the tracked secret-package manifest. The manifest contains names only.
 *
 * @param {{ manifestPath?: string }} [options]
 */
export function loadSecretPackageManifest(options = {}) {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  let source;
  try {
    source = readFileSync(manifestPath, 'utf8');
  } catch {
    throw packageError(`manifest file is unavailable: ${basename(manifestPath)}`);
  }
  return validateSecretPackageManifest(parseStrictJson(source, 'manifest'));
}

/** Parse JSON with duplicate-key rejection without including its contents in errors. */
export function parseSecretPackageJson(value, label = 'payload') {
  const data = toBuffer(value, `${label} JSON`);
  if (data.byteLength > MAX_PAYLOAD_BYTES) {
    throw packageError(`${label} exceeds the Secret Manager 64 KiB limit`);
  }
  return parseStrictJson(data.toString('utf8'), label);
}

/**
 * Validate the exact manifest schema and return it without secret material.
 *
 * @param {unknown} candidate
 */
export function validateSecretPackageManifest(candidate) {
  assertPlainObject(candidate, 'manifest');
  assertExactKeys(candidate, MANIFEST_KEYS, 'manifest');
  if (candidate.schemaVersion !== 1) {
    throw packageError('manifest schemaVersion is unsupported');
  }

  const nativeSecretNames = readSortedNames(candidate.nativeSecretNames, 'native secret names');
  if (!sameItems(nativeSecretNames, NATIVE_SECRET_NAMES)) {
    throw packageError('manifest native secret names do not match the required exceptions');
  }

  assertPlainObject(candidate.packages, 'manifest packages');
  assertExactKeys(candidate.packages, ENVIRONMENTS, 'manifest packages');

  const packages = {};
  for (const environment of ENVIRONMENTS) {
    const definition = candidate.packages[environment];
    assertPlainObject(definition, `manifest ${environment} package definition`);
    assertExactKeys(definition, PACKAGE_KEYS, `manifest ${environment} package definition`);

    if (definition.secretId !== PACKAGE_SECRET_IDS[environment]) {
      throw packageError(`manifest ${environment} package secretId is invalid`);
    }
    if (!Number.isSafeInteger(definition.stableVersion) || definition.stableVersion < 1) {
      throw packageError(
        `manifest ${environment} package stableVersion must be a positive integer`
      );
    }

    const envNames = readSortedNames(definition.envNames, `${environment} package env names`);
    if (!envNames.includes(FIREBASE_API_KEY)) {
      throw packageError(`manifest ${environment} package is missing the Firebase API key`);
    }
    const expectedNativeMembers =
      environment === 'dev' ? NATIVE_SECRET_NAMES : ['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    const actualNativeMembers = envNames.filter((name) => nativeSecretNames.includes(name));
    if (!sameItems(actualNativeMembers, expectedNativeMembers)) {
      throw packageError(`manifest ${environment} package native member projection is invalid`);
    }

    const files = readSortedStrings(definition.files, `${environment} package files`);
    if (!sameItems(files, PACKAGE_FILE_NAMES[environment])) {
      throw packageError(`manifest ${environment} package files do not match the required set`);
    }

    packages[environment] = {
      secretId: definition.secretId,
      stableVersion: definition.stableVersion,
      envNames,
      files,
    };
  }

  return { schemaVersion: 1, nativeSecretNames, packages };
}

/**
 * Validate a package payload and return metadata only.
 *
 * @param {{
 *   environment: 'dev' | 'prod',
 *   payload: unknown,
 *   manifest?: ReturnType<typeof validateSecretPackageManifest>,
 *   serializedData?: Buffer | Uint8Array | string,
 * }} options
 */
export function validateSecretPackagePayload(options) {
  const environment = readEnvironment(options?.environment);
  const manifest = options?.manifest
    ? validateSecretPackageManifest(options.manifest)
    : loadSecretPackageManifest();
  const payload = options?.payload;

  assertPlainObject(payload, 'payload');
  assertExactKeys(payload, PAYLOAD_KEYS, 'payload');
  if (payload.schemaVersion !== 1) {
    throw packageError('payload schemaVersion is unsupported');
  }
  if (payload.environment !== environment) {
    throw packageError('payload environment does not match the requested environment');
  }

  const definition = manifest.packages[environment];
  assertPlainObject(payload.env, 'payload env');
  assertExactKeys(payload.env, definition.envNames, 'payload env');
  for (const name of definition.envNames) {
    const value = payload.env[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw packageError('payload env contains an empty or non-string value');
    }
    if (value.includes('\0')) {
      throw packageError('payload env contains a forbidden control character');
    }
    if (/[\r\n]/u.test(value)) {
      throw packageError('payload env contains a forbidden line break');
    }
  }
  assertPlainObject(payload.files, 'payload files');
  assertExactKeys(payload.files, definition.files, 'payload files');
  const serializedData =
    options?.serializedData === undefined
      ? serializeSecretPackagePayload(payload, definition)
      : toBuffer(options.serializedData, 'serialized payload');
  if (serializedData.byteLength > MAX_PAYLOAD_BYTES) {
    throw packageError('payload exceeds the Secret Manager 64 KiB limit');
  }

  if (!FIREBASE_API_KEY_PATTERN.test(payload.env[FIREBASE_API_KEY])) {
    throw packageError('payload Firebase API key format is invalid');
  }

  const decodedFiles = {};
  for (const name of definition.files) {
    decodedFiles[name] = decodeStrictBase64(payload.files[name]);
  }

  if (decodedFiles.githubAppPrivateKeyPemBase64 !== undefined) {
    validatePrivateKeyPem(decodedFiles.githubAppPrivateKeyPemBase64, 'GitHub App private key');
  }
  if (decodedFiles.tlsPrivateKeyPemBase64 !== undefined) {
    validatePrivateKeyPem(decodedFiles.tlsPrivateKeyPemBase64, 'TLS private key');
  }
  if (decodedFiles.cloudflareDnsApiTokenBase64 !== undefined) {
    validateOpaqueFile(decodedFiles.cloudflareDnsApiTokenBase64, 'Cloudflare DNS API token');
  }

  let serviceAccount;
  if (decodedFiles.runtimeGcpServiceAccountJsonBase64 !== undefined) {
    serviceAccount = validateServiceAccount(decodedFiles.runtimeGcpServiceAccountJsonBase64);
  }

  return {
    valid: true,
    environment,
    byteLength: serializedData.byteLength,
    crc32c: crc32cBase64(serializedData),
    envNames: [...definition.envNames],
    files: definition.files.map((name) => RENDERED_FILE_NAMES[name]),
    ...(serviceAccount === undefined ? {} : { serviceAccount }),
  };
}

/** @param {Buffer | Uint8Array | string} value */
export function crc32c(value) {
  const data = toBuffer(value, 'CRC32C input');
  const table = getCrc32cTable();
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum = table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

/** @param {Buffer | Uint8Array | string} value */
export function crc32cBase64(value) {
  const encoded = Buffer.allocUnsafe(4);
  encoded.writeUInt32BE(crc32c(value), 0);
  return encoded.toString('base64');
}

/**
 * Fetch and validate one immutable Secret Manager version.
 *
 * @param {{
 *   adapter: { accessVersion: Function },
 *   environment: 'dev' | 'prod',
 *   manifest?: ReturnType<typeof validateSecretPackageManifest>,
 *   projectId: string,
 *   version: number | string,
 * }} options
 */
export async function fetchSecretPackage(options) {
  const environment = readEnvironment(options?.environment);
  const manifest = options?.manifest
    ? validateSecretPackageManifest(options.manifest)
    : loadSecretPackageManifest();
  const projectId = readProjectId(options?.projectId);
  const version = readNumericVersion(options?.version);
  if (typeof options?.adapter?.accessVersion !== 'function') {
    throw packageError('Secret Manager access adapter is unavailable');
  }

  let response;
  try {
    response = await options.adapter.accessVersion({
      projectId,
      secretId: manifest.packages[environment].secretId,
      version,
    });
  } catch {
    throw packageError('Secret Manager version access failed');
  }
  assertPlainObject(response, 'Secret Manager access response');
  const data = toBuffer(response.data, 'Secret Manager payload');
  validateChecksum(response.dataCrc32c, data, 'Secret Manager payload');

  const payload = parseStrictJson(data.toString('utf8'), 'payload');
  const metadata = validateSecretPackagePayload({
    environment,
    manifest,
    payload,
    serializedData: data,
  });
  return { payload, environment, version, crc32c: metadata.crc32c, metadata };
}

/**
 * Publish a validated payload through an injected Secret Manager adapter.
 *
 * @param {{
 *   adapter: { accessVersion: Function, addVersion: Function },
 *   environment: 'dev' | 'prod',
 *   manifest?: ReturnType<typeof validateSecretPackageManifest>,
 *   payload: unknown,
 *   projectId: string,
 * }} options
 */
export async function publishSecretPackage(options) {
  const environment = readEnvironment(options?.environment);
  const manifest = options?.manifest
    ? validateSecretPackageManifest(options.manifest)
    : loadSecretPackageManifest();
  const projectId = readProjectId(options?.projectId);
  if (
    typeof options?.adapter?.addVersion !== 'function' ||
    typeof options?.adapter?.accessVersion !== 'function'
  ) {
    throw packageError('Secret Manager publish adapter is unavailable');
  }

  const definition = manifest.packages[environment];
  const metadata = validateSecretPackagePayload({
    environment,
    manifest,
    payload: options?.payload,
  });
  const data = serializeSecretPackagePayload(options.payload, definition);
  const dataCrc32c = crc32cBase64(data);

  let response;
  try {
    response = await options.adapter.addVersion({
      projectId,
      secretId: definition.secretId,
      data,
      dataCrc32c,
    });
  } catch {
    throw packageError('Secret Manager version publish failed');
  }
  assertPlainObject(response, 'Secret Manager publish response');
  const version = readNumericVersion(response.version);

  let observedResponse;
  try {
    observedResponse = await options.adapter.accessVersion({
      projectId,
      secretId: definition.secretId,
      version,
    });
  } catch {
    throw packageError('published Secret Manager version verification failed');
  }
  assertPlainObject(observedResponse, 'published Secret Manager access response');
  const observedData = toBuffer(observedResponse.data, 'published Secret Manager payload');
  validateChecksum(observedResponse.dataCrc32c, observedData, 'published Secret Manager payload');
  if (observedData.byteLength !== data.byteLength || !timingSafeEqual(observedData, data)) {
    throw packageError('published Secret Manager payload bytes verification failed');
  }

  return {
    environment,
    secretId: definition.secretId,
    version,
    byteLength: metadata.byteLength,
    crc32c: dataCrc32c,
  };
}

/**
 * Atomically render a validated package as an immutable release and switch `current`.
 *
 * @param {{
 *   environment: 'dev' | 'prod',
 *   manifest?: ReturnType<typeof validateSecretPackageManifest>,
 *   outputDir: string,
 *   payload: unknown,
 *   version: number | string,
 * }} options
 */
export function renderSecretPackage(options) {
  const environment = readEnvironment(options?.environment);
  const manifest = options?.manifest
    ? validateSecretPackageManifest(options.manifest)
    : loadSecretPackageManifest();
  const version = readNumericVersion(options?.version);
  const outputDir = readOutputDirectory(options?.outputDir);
  const definition = manifest.packages[environment];
  const metadata = validateSecretPackagePayload({
    environment,
    manifest,
    payload: options?.payload,
  });
  const checksumHex = crc32c(serializeSecretPackagePayload(options.payload, definition))
    .toString(16)
    .padStart(8, '0');
  const releaseName = `${environment}-v${version}-${checksumHex}`;
  const releasePath = join(outputDir, releaseName);
  const currentPath = join(outputDir, 'current');

  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  chmodSync(outputDir, 0o700);
  let stagingPath = mkdtempSync(join(outputDir, '.staging-'));
  chmodSync(stagingPath, 0o700);
  let temporaryLink;

  try {
    writePrivateFile(
      join(stagingPath, 'environment.env'),
      renderDotenv(options.payload.env, definition.envNames)
    );
    for (const name of definition.files) {
      writePrivateFile(
        join(stagingPath, RENDERED_FILE_NAMES[name]),
        decodeStrictBase64(options.payload.files[name])
      );
    }

    const releaseMetadata = {
      schemaVersion: 1,
      environment,
      secretId: definition.secretId,
      version,
      byteLength: metadata.byteLength,
      crc32c: metadata.crc32c,
      envNames: [...definition.envNames],
      files: metadata.files,
      ...(metadata.serviceAccount === undefined ? {} : { serviceAccount: metadata.serviceAccount }),
    };
    writePrivateFile(join(stagingPath, 'metadata.json'), `${JSON.stringify(releaseMetadata)}\n`);
    syncDirectory(stagingPath);

    if (existsSync(releasePath)) {
      assertExistingRelease(releasePath, stagingPath, releaseMetadata);
      rmSync(stagingPath, { recursive: true, force: true });
      stagingPath = undefined;
    } else {
      renameSync(stagingPath, releasePath);
      stagingPath = undefined;
      syncDirectory(outputDir);
    }

    temporaryLink = join(outputDir, `.current-${process.pid}-${randomUUID()}`);
    symlinkSync(releaseName, temporaryLink, 'dir');
    renameSync(temporaryLink, currentPath);
    temporaryLink = undefined;
    syncDirectory(outputDir);

    return { environment, version, releaseName, metadata: releaseMetadata };
  } catch (error) {
    if (temporaryLink !== undefined) rmSync(temporaryLink, { force: true });
    if (stagingPath !== undefined) rmSync(stagingPath, { recursive: true, force: true });
    if (error instanceof SecretPackageError) throw error;
    throw packageError('atomic package render failed');
  }
}

/**
 * Compare two valid packages without returning secret material or fingerprints.
 *
 * @param {{
 *   environment: 'dev' | 'prod',
 *   hmacKey: Buffer | Uint8Array | string,
 *   left: unknown,
 *   manifest?: ReturnType<typeof validateSecretPackageManifest>,
 *   right: unknown,
 * }} options
 * @returns {'MATCH' | 'MISMATCH'}
 */
export function dualCompareSecretPackages(options) {
  const environment = readEnvironment(options?.environment);
  const manifest = options?.manifest
    ? validateSecretPackageManifest(options.manifest)
    : loadSecretPackageManifest();
  validateSecretPackagePayload({ environment, manifest, payload: options?.left });
  validateSecretPackagePayload({ environment, manifest, payload: options?.right });

  const hmacKey = toBuffer(options?.hmacKey, 'HMAC key');
  if (hmacKey.byteLength < 32) {
    throw packageError('HMAC key must contain at least 32 bytes');
  }
  const definition = manifest.packages[environment];
  const leftDigest = createHmac('sha256', hmacKey)
    .update(serializeSecretPackagePayload(options.left, definition))
    .digest();
  const rightDigest = createHmac('sha256', hmacKey)
    .update(serializeSecretPackagePayload(options.right, definition))
    .digest();
  return timingSafeEqual(leftDigest, rightDigest) ? 'MATCH' : 'MISMATCH';
}

/**
 * Node-core gcloud adapter. The payload is passed over stdin/stdout and is never logged.
 *
 * @param {{ execFile?: typeof execFileSync }} [dependencies]
 */
export function createGcloudSecretManagerAdapter(dependencies = {}) {
  const execFile = dependencies.execFile ?? execFileSync;
  return {
    async accessVersion({ projectId, secretId, version }) {
      const exactVersion = readNumericVersion(version);
      let output;
      try {
        output = execFile(
          'gcloud',
          [
            'secrets',
            'versions',
            'access',
            exactVersion,
            '--secret',
            secretId,
            '--project',
            projectId,
            '--format=json',
          ],
          { encoding: 'utf8', maxBuffer: MAX_PAYLOAD_BYTES * 2, stdio: ['ignore', 'pipe', 'pipe'] }
        );
      } catch {
        throw packageError('gcloud Secret Manager access failed');
      }
      let response;
      try {
        response = JSON.parse(String(output));
      } catch {
        throw packageError('gcloud Secret Manager response is invalid');
      }
      if (
        !isPlainObject(response) ||
        !isPlainObject(response.payload) ||
        typeof response.payload.data !== 'string' ||
        !/^[A-Za-z0-9_-]+={0,2}$/u.test(response.payload.data) ||
        typeof response.payload.dataCrc32c !== 'string' ||
        !/^\d+$/u.test(response.payload.dataCrc32c)
      ) {
        throw packageError('gcloud Secret Manager response metadata is invalid');
      }
      const data = Buffer.from(response.payload.data, 'base64url');
      return { data, dataCrc32c: BigInt(response.payload.dataCrc32c) };
    },

    async addVersion({ data, dataCrc32c, projectId, secretId }) {
      const payload = toBuffer(data, 'gcloud Secret Manager payload');
      validateChecksum(dataCrc32c, payload, 'gcloud Secret Manager payload');
      let output;
      try {
        output = execFile(
          'gcloud',
          [
            'secrets',
            'versions',
            'add',
            secretId,
            '--project',
            projectId,
            '--data-file=-',
            '--format=value(name)',
          ],
          {
            encoding: 'utf8',
            input: payload,
            maxBuffer: MAX_PAYLOAD_BYTES * 2,
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
      } catch {
        throw packageError('gcloud Secret Manager publish failed');
      }
      const match = String(output)
        .trim()
        .match(/\/versions\/([1-9]\d*)$/u);
      if (match === null) {
        throw packageError('gcloud Secret Manager returned an invalid version');
      }
      return { version: match[1] };
    },
  };
}

/** Write a payload file with a same-directory atomic rename and private permissions. */
export function writeSecretPackagePayload(path, payload, definition) {
  if (typeof path !== 'string' || path.length === 0) {
    throw packageError('payload output path is required');
  }
  const parent = dirname(resolve(path));
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporaryPath = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writePrivateFile(temporaryPath, serializeSecretPackagePayload(payload, definition));
    renameSync(temporaryPath, resolve(path));
    syncDirectory(parent);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (error instanceof SecretPackageError) throw error;
    throw packageError('atomic payload write failed');
  }
}

export class SecretPackageError extends Error {
  constructor(message) {
    super(`Secret package ${message}`);
    this.name = 'SecretPackageError';
  }
}

function validateServiceAccount(data) {
  let account;
  try {
    account = parseStrictJson(data.toString('utf8'), 'service-account file');
  } catch {
    throw packageError('runtime GCP service-account JSON is invalid');
  }
  assertPlainObject(account, 'runtime GCP service-account JSON');
  assertExactKeys(account, SERVICE_ACCOUNT_KEYS, 'runtime GCP service-account JSON');
  if (account.type !== 'service_account') {
    throw packageError('runtime GCP service-account type is invalid');
  }
  if (account.project_id !== SERVICE_ACCOUNT_PROJECT_ID) {
    throw packageError('runtime GCP service-account project metadata is invalid');
  }
  if (
    typeof account.client_email !== 'string' ||
    !new RegExp(
      `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]@${SERVICE_ACCOUNT_PROJECT_ID}\\.iam\\.gserviceaccount\\.com$`,
      'u'
    ).test(account.client_email)
  ) {
    throw packageError('runtime GCP service-account email metadata is invalid');
  }
  if (typeof account.client_id !== 'string' || !/^\d{21}$/u.test(account.client_id)) {
    throw packageError('runtime GCP service-account client ID metadata is invalid');
  }
  if (
    typeof account.private_key_id !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(account.private_key_id)
  ) {
    throw packageError('runtime GCP service-account private key ID metadata is invalid');
  }
  if (
    account.auth_uri !== 'https://accounts.google.com/o/oauth2/auth' ||
    account.token_uri !== 'https://oauth2.googleapis.com/token' ||
    account.auth_provider_x509_cert_url !== 'https://www.googleapis.com/oauth2/v1/certs' ||
    account.universe_domain !== 'googleapis.com'
  ) {
    throw packageError('runtime GCP service-account endpoint metadata is invalid');
  }
  const expectedCertificateUrl =
    `https://www.googleapis.com/robot/v1/metadata/x509/` + encodeURIComponent(account.client_email);
  if (account.client_x509_cert_url !== expectedCertificateUrl) {
    throw packageError('runtime GCP service-account certificate metadata is invalid');
  }
  validatePrivateKeyPem(Buffer.from(account.private_key, 'utf8'), 'runtime GCP private key');
  return {
    clientEmail: account.client_email,
    privateKeyId: account.private_key_id,
    projectId: account.project_id,
  };
}

function validatePrivateKeyPem(data, label) {
  const value = data.toString('utf8');
  if (
    !/^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC )?PRIVATE KEY-----\n?$/u.test(
      value
    )
  ) {
    throw packageError(`${label} PEM is invalid`);
  }
  try {
    createPrivateKey(value);
  } catch {
    throw packageError(`${label} PEM is invalid`);
  }
}

function validateOpaqueFile(data, label) {
  const value = data.toString('utf8');
  if (value.length === 0 || value.trim() !== value || /[\r\n\0]/u.test(value)) {
    throw packageError(`${label} is invalid`);
  }
}

function decodeStrictBase64(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw packageError('payload file value is not canonical base64');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength === 0 || decoded.toString('base64') !== value) {
    throw packageError('payload file value is not canonical base64');
  }
  return decoded;
}

function serializeSecretPackagePayload(payload, definition) {
  const canonical = {
    schemaVersion: 1,
    environment: payload.environment,
    env: Object.fromEntries(definition.envNames.map((name) => [name, payload.env[name]])),
    files: Object.fromEntries(definition.files.map((name) => [name, payload.files[name]])),
  };
  return Buffer.from(JSON.stringify(canonical), 'utf8');
}

function renderDotenv(env, names) {
  // dotenv's parser treats backslashes in double-quoted JSON.stringify output
  // as literal characters (except \n/\r), corrupting JWK and JSON members.
  // Values are single-line by contract, so raw single-quoted dotenv preserves
  // quotes and backslashes byte-for-byte; the parser closes on the final quote.
  return `${names.map((name) => `${name}='${env[name]}'`).join('\n')}\n`;
}

function writePrivateFile(path, data) {
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
}

function assertExistingRelease(releasePath, stagingPath, metadata) {
  let status;
  try {
    status = lstatSync(releasePath);
  } catch {
    throw packageError('existing immutable release is unavailable');
  }
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
    throw packageError('existing immutable release path is invalid');
  }
  let existing;
  try {
    existing = parseStrictJson(
      readFileSync(join(releasePath, 'metadata.json'), 'utf8'),
      'metadata'
    );
  } catch {
    throw packageError('existing immutable release metadata is invalid');
  }
  if (JSON.stringify(existing) !== JSON.stringify(metadata)) {
    throw packageError('existing immutable release metadata does not match');
  }

  let expectedNames;
  let actualNames;
  try {
    expectedNames = readdirSync(stagingPath).sort();
    actualNames = readdirSync(releasePath).sort();
  } catch {
    throw packageError('existing immutable release contents are unavailable');
  }
  if (!sameItems(actualNames, expectedNames)) {
    throw packageError('existing immutable release contents do not match');
  }
  for (const name of expectedNames) {
    let existingStatus;
    let expectedStatus;
    let existingBytes;
    let expectedBytes;
    try {
      existingStatus = lstatSync(join(releasePath, name));
      expectedStatus = lstatSync(join(stagingPath, name));
      existingBytes = readFileSync(join(releasePath, name));
      expectedBytes = readFileSync(join(stagingPath, name));
    } catch {
      throw packageError('existing immutable release contents are unavailable');
    }
    if (
      !existingStatus.isFile() ||
      existingStatus.isSymbolicLink() ||
      (existingStatus.mode & 0o777) !== 0o600 ||
      !expectedStatus.isFile() ||
      existingBytes.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(existingBytes, expectedBytes)
    ) {
      throw packageError('existing immutable release contents do not match');
    }
  }
}

function syncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readEnvironment(environment) {
  if (typeof environment !== 'string' || !ENVIRONMENT_SET.has(environment)) {
    throw packageError('environment must be dev or prod');
  }
  return environment;
}

function readProjectId(projectId) {
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    throw packageError('GCP project ID is invalid');
  }
  return projectId;
}

function readNumericVersion(version) {
  const value = typeof version === 'number' ? String(version) : version;
  if (
    typeof value !== 'string' ||
    !NUMERIC_VERSION_PATTERN.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw packageError('Secret Manager version must be an exact positive numeric version');
  }
  return value;
}

function readOutputDirectory(outputDir) {
  if (typeof outputDir !== 'string' || outputDir.length === 0 || outputDir.includes('\0')) {
    throw packageError('render output directory is invalid');
  }
  return resolve(outputDir);
}

function validateChecksum(expected, data, label) {
  const actualBase64 = crc32cBase64(data);
  let matches = false;
  if (typeof expected === 'string' && BASE64_PATTERN.test(expected)) {
    matches = expected === actualBase64;
  } else if (typeof expected === 'number' && Number.isSafeInteger(expected)) {
    matches = expected === crc32c(data);
  } else if (typeof expected === 'bigint') {
    matches = expected === BigInt(crc32c(data));
  }
  if (!matches) {
    throw packageError(`${label} CRC32C verification failed`);
  }
}

function getCrc32cTable() {
  if (crc32cTable !== undefined) return crc32cTable;
  crc32cTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0x82f63b78 ^ (value >>> 1) : value >>> 1;
    }
    crc32cTable[index] = value >>> 0;
  }
  return crc32cTable;
}

function toBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw packageError(`${label} must be bytes or a string`);
}

function readSortedNames(value, label) {
  const names = readSortedStrings(value, label);
  if (names.some((name) => !ENV_NAME_PATTERN.test(name))) {
    throw packageError(`manifest ${label} contains an invalid environment name`);
  }
  return names;
}

function readSortedStrings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw packageError(`manifest ${label} must be a string array`);
  }
  if (new Set(value).size !== value.length) {
    throw packageError(`manifest ${label} contains a duplicate`);
  }
  const sorted = [...value].sort();
  if (!sameItems(value, sorted)) {
    throw packageError(`manifest ${label} must be sorted`);
  }
  return [...value];
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw packageError(`${label} must be an object`);
  }
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (sameItems(actual, sortedExpected)) return;
  const missing = sortedExpected.find((name) => !actual.includes(name));
  if (missing !== undefined) {
    throw packageError(`${label} is missing a required key`);
  }
  throw packageError(`${label} contains an unknown key`);
}

function sameItems(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function packageError(message) {
  return new SecretPackageError(message);
}

function parseStrictJson(source, label) {
  let index = 0;

  function fail(reason) {
    throw packageError(`${label} contains invalid JSON (${reason})`);
  }

  function skipWhitespace() {
    while (index < source.length && /\s/u.test(source[index] ?? '')) index += 1;
  }

  function parseValue() {
    skipWhitespace();
    const token = source[index];
    if (token === '{') return parseObject();
    if (token === '[') return parseArray();
    if (token === '"') return parseString();
    if (source.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (source.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (source.startsWith('null', index)) {
      index += 4;
      return null;
    }
    return parseNumber();
  }

  function parseObject() {
    index += 1;
    const result = Object.create(null);
    const keys = new Set();
    skipWhitespace();
    if (source[index] === '}') {
      index += 1;
      return result;
    }
    while (index < source.length) {
      skipWhitespace();
      if (source[index] !== '"') fail('object key expected');
      const key = parseString();
      if (keys.has(key)) fail('duplicate key');
      keys.add(key);
      skipWhitespace();
      if (source[index] !== ':') fail('colon expected');
      index += 1;
      result[key] = parseValue();
      skipWhitespace();
      if (source[index] === '}') {
        index += 1;
        return result;
      }
      if (source[index] !== ',') fail('comma expected');
      index += 1;
    }
    fail('unterminated object');
  }

  function parseArray() {
    index += 1;
    const result = [];
    skipWhitespace();
    if (source[index] === ']') {
      index += 1;
      return result;
    }
    while (index < source.length) {
      result.push(parseValue());
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return result;
      }
      if (source[index] !== ',') fail('comma expected');
      index += 1;
    }
    fail('unterminated array');
  }

  function parseString() {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const character = source[index] ?? '';
      if (!escaped && character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch {
          fail('invalid string');
        }
      }
      if (!escaped && character === '\\') escaped = true;
      else escaped = false;
      index += 1;
    }
    fail('unterminated string');
  }

  function parseNumber() {
    const match = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (match === null) fail('value expected');
    index += match[0].length;
    return Number(match[0]);
  }

  const result = parseValue();
  skipWhitespace();
  if (index !== source.length) fail('trailing content');
  return result;
}
