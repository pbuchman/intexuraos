import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_ROOT = resolve(MODULE_DIRECTORY, '..', '..', 'config', 'environments');
const ENVIRONMENTS = new Set(['dev', 'prod']);
const FORMATS = new Set(['dotenv', 'shell-export']);
const ENV_NAME_PATTERN = /^INTEXURAOS_[A-Z0-9_]+$/u;
const SENSITIVE_CONFIG_NAME_PATTERN =
  /(?:_TOKEN|_SECRET|_PASSWORD|_PRIVATE_KEY|_ENCRYPTION_KEY|_HMAC_KEY|_API_KEY)$/u;
const POLICY_KEYS = [
  'deleteOnlyNames',
  'migrationRollbackSecretNames',
  'schemaVersion',
  'scopes',
  'secretManagerNames',
  'sensitiveConfigNameAllowlist',
];
const SCOPE_KEYS = ['common', 'dev', 'prod'];

/**
 * Load and validate the classification policy without exposing configuration values.
 *
 * @param {{ configRoot?: string }} [options]
 */
export function loadRuntimePolicy(options = {}) {
  const configRoot = options.configRoot ?? DEFAULT_CONFIG_ROOT;
  const policy = readStrictJson(resolve(configRoot, 'policy.json'));
  assertPlainObject(policy, 'runtime config policy');
  assertExactKeys(policy, POLICY_KEYS, 'runtime config policy');

  if (policy.schemaVersion !== 1) {
    throw configError('runtime config policy schemaVersion is unsupported');
  }

  assertPlainObject(policy.scopes, 'runtime config policy scopes');
  assertExactKeys(policy.scopes, SCOPE_KEYS, 'runtime config policy scopes');

  const scopes = {
    common: readNameList(policy.scopes.common, 'policy common scope'),
    dev: readNameList(policy.scopes.dev, 'policy dev scope'),
    prod: readNameList(policy.scopes.prod, 'policy prod scope'),
  };
  const secretManagerNames = readNameList(
    policy.secretManagerNames,
    'policy Secret Manager classification'
  );
  const deleteOnlyNames = readNameList(policy.deleteOnlyNames, 'policy delete-only classification');
  const migrationRollbackSecretNames = readNameList(
    policy.migrationRollbackSecretNames,
    'policy migration rollback classification'
  );
  const sensitiveConfigNameAllowlist = readNameList(
    policy.sensitiveConfigNameAllowlist,
    'policy sensitive config allowlist'
  );

  const configNames = [...scopes.common, ...scopes.dev, ...scopes.prod];
  assertUnique(configNames, 'runtime config policy scopes');

  const configSet = new Set(configNames);
  const secretManagerSet = new Set(secretManagerNames);
  const deleteOnlySet = new Set(deleteOnlyNames);
  const rollbackSet = new Set(migrationRollbackSecretNames);
  const sensitiveAllowSet = new Set(sensitiveConfigNameAllowlist);

  for (const name of deleteOnlyNames) {
    if (configSet.has(name)) {
      throw configError(`delete-only name is also runtime config: ${name}`);
    }
  }

  for (const name of migrationRollbackSecretNames) {
    if (!secretManagerSet.has(name)) {
      throw configError(`migration rollback name is not in Secret Manager policy: ${name}`);
    }
    if (!configSet.has(name) && !deleteOnlySet.has(name)) {
      throw configError(
        `migration rollback name has no config or delete-only classification: ${name}`
      );
    }
  }

  const expectedRollbackNames = [
    ...configNames.filter((name) => secretManagerSet.has(name)),
    ...deleteOnlyNames,
  ].sort();
  if (!sameNames(expectedRollbackNames, migrationRollbackSecretNames)) {
    throw configError('migration rollback classification is not the only config-vs-secret overlap');
  }

  for (const name of configNames) {
    if (secretManagerSet.has(name) && !rollbackSet.has(name)) {
      throw configError(`runtime config has an unapproved Secret Manager overlap: ${name}`);
    }
    if (SENSITIVE_CONFIG_NAME_PATTERN.test(name) && !sensitiveAllowSet.has(name)) {
      throw configError(`sensitive config classification requires explicit allowlist: ${name}`);
    }
  }

  for (const name of sensitiveConfigNameAllowlist) {
    if (!configSet.has(name) || !SENSITIVE_CONFIG_NAME_PATTERN.test(name)) {
      throw configError(`invalid sensitive config allowlist entry: ${name}`);
    }
  }

  return {
    schemaVersion: 1,
    scopes,
    secretManagerNames,
    deleteOnlyNames,
    migrationRollbackSecretNames,
    sensitiveConfigNameAllowlist,
  };
}

/**
 * Load the tracked non-secret configuration for an environment.
 *
 * @param {{ environment: 'dev' | 'prod', configRoot?: string }} options
 * @returns {Record<string, string>}
 */
export function loadRuntimeConfig(options) {
  const environment = readEnvironment(options?.environment);
  const configRoot = options?.configRoot ?? DEFAULT_CONFIG_ROOT;
  const policy = loadRuntimePolicy({ configRoot });
  const common = readConfigScope(configRoot, 'common', policy.scopes.common);
  const environmentConfig = readConfigScope(configRoot, environment, policy.scopes[environment]);
  const config = { ...common, ...environmentConfig };

  validateMatrixSigningPublicKey(config);
  validateFirebaseApiKey(config);
  return Object.fromEntries(
    Object.entries(config).sort(([left], [right]) => left.localeCompare(right))
  );
}

/**
 * Validate configuration and return metadata only.
 *
 * @param {{ environment: 'dev' | 'prod', configRoot?: string }} options
 */
export function validateRuntimeConfig(options) {
  const environment = readEnvironment(options?.environment);
  const config = loadRuntimeConfig({ ...options, environment });
  return {
    valid: true,
    environment,
    configNames: Object.keys(config),
  };
}

/**
 * Render configuration for the existing shell- and dotenv-based runtime loaders.
 *
 * @param {{
 *   environment: 'dev' | 'prod',
 *   configRoot?: string,
 *   format: 'dotenv' | 'shell-export',
 *   keys?: string[],
 * }} options
 */
export function renderRuntimeConfig(options) {
  const environment = readEnvironment(options?.environment);
  const format = options?.format;
  if (!FORMATS.has(format)) {
    throw configError('runtime config output format is unsupported');
  }

  const config = loadRuntimeConfig({ environment, configRoot: options?.configRoot });
  const names = readRequestedNames(options?.keys, config);
  const lines = names.map((name) => {
    const value = config[name];
    if (value === undefined) {
      throw configError(`runtime config key is unavailable: ${name}`);
    }
    return format === 'shell-export'
      ? `export ${name}=${shellQuote(value)}`
      : `${name}=${dotenvQuote(value, name)}`;
  });
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function readEnvironment(environment) {
  if (typeof environment !== 'string' || !ENVIRONMENTS.has(environment)) {
    throw configError('runtime config environment is unsupported');
  }
  return environment;
}

function readConfigScope(configRoot, scope, expectedNames) {
  const source = resolve(configRoot, `${scope}.json`);
  const config = readStrictJson(source);
  assertPlainObject(config, `${scope} runtime config`);
  assertExactKeys(config, expectedNames, `${scope} runtime config`);

  const result = {};
  for (const name of expectedNames) {
    const value = config[name];
    if (typeof value !== 'string') {
      throw configError(`runtime config value is not a string: ${name}`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw configError(`runtime config value is empty or padded: ${name}`);
    }
    if (/[\r\n\0]/u.test(value)) {
      throw configError(`runtime config value contains a forbidden control character: ${name}`);
    }
    result[name] = value;
  }
  return result;
}

function validateMatrixSigningPublicKey(config) {
  const name = 'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY';
  const versionName = 'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION';
  const material = config[name];
  const version = config[versionName];
  if (material === undefined || version === undefined) return;

  let candidate;
  try {
    candidate = JSON.parse(material);
  } catch {
    throw configError(`runtime config public key is invalid: ${name}`);
  }
  if (!isPlainObject(candidate)) {
    throw configError(`runtime config public key is invalid: ${name}`);
  }
  const expectedKeys = ['crv', 'kid', 'kty', 'x'];
  const actualKeys = Object.keys(candidate).sort();
  if (
    !sameNames(actualKeys, expectedKeys) ||
    candidate.kty !== 'OKP' ||
    candidate.crv !== 'Ed25519' ||
    candidate.kid !== version ||
    typeof candidate.x !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(candidate.x)
  ) {
    throw configError(`runtime config public key is invalid: ${name}`);
  }
}

function validateFirebaseApiKey(config) {
  const name = 'INTEXURAOS_FIREBASE_API_KEY';
  const value = config[name];
  if (value !== undefined && !/^AIza[A-Za-z0-9_-]{35}$/u.test(value)) {
    throw configError(`runtime config Firebase API key format is invalid: ${name}`);
  }
}

function readRequestedNames(keys, config) {
  if (keys === undefined) return Object.keys(config).sort();
  if (!Array.isArray(keys)) {
    throw configError('runtime config requested keys must be an array');
  }
  const names = keys.map((name) => {
    if (typeof name !== 'string' || !ENV_NAME_PATTERN.test(name)) {
      throw configError('runtime config requested key name is invalid');
    }
    if (!Object.hasOwn(config, name)) {
      throw configError(`runtime config requested key is unavailable: ${name}`);
    }
    return name;
  });
  assertUnique(names, 'runtime config requested keys');
  return names.sort();
}

function readNameList(value, label) {
  if (!Array.isArray(value)) {
    throw configError(`${label} must be an array`);
  }
  const names = value.map((name) => {
    if (typeof name !== 'string' || !ENV_NAME_PATTERN.test(name)) {
      throw configError(`${label} contains an invalid name`);
    }
    return name;
  });
  assertUnique(names, label);
  const sorted = [...names].sort();
  if (!sameNames(names, sorted)) {
    throw configError(`${label} must be sorted`);
  }
  return names;
}

function assertUnique(names, label) {
  if (new Set(names).size !== names.length) {
    throw configError(`${label} contains a duplicate name`);
  }
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw configError(`${label} must be an object`);
  }
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (!sameNames(actualKeys, sortedExpected)) {
    const unknown = actualKeys.find((name) => !sortedExpected.includes(name));
    const missing = sortedExpected.find((name) => !actualKeys.includes(name));
    if (unknown !== undefined) {
      throw configError(`${label} contains an unknown key: ${unknown}`);
    }
    throw configError(`${label} is missing a required key: ${String(missing)}`);
  }
}

function sameNames(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function dotenvQuote(value, name) {
  if (value.includes("'")) {
    throw configError(`runtime config value cannot be represented safely as dotenv: ${name}`);
  }
  return `'${value}'`;
}

function configError(message) {
  return new Error(`Runtime configuration error: ${message}`);
}

function readStrictJson(path) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    throw configError(`configuration file is unavailable: ${path.split('/').pop() ?? 'unknown'}`);
  }
  return parseStrictJson(source, path.split('/').pop() ?? 'configuration');
}

function parseStrictJson(source, label) {
  let index = 0;

  function fail(reason) {
    throw configError(`${label} contains invalid JSON (${reason})`);
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
      if (keys.has(key)) {
        throw configError(`${label} contains duplicate key: ${key}`);
      }
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
      if (!escaped && character === '\\') {
        escaped = true;
      } else {
        escaped = false;
      }
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
