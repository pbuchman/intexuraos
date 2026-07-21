const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

type Environment = Readonly<Record<string, string | undefined>>;

export type IntexMatrixCorpusConfig =
  | { enabled: false; runtimeAudience: 'disabled' }
  | {
      enabled: true;
      runtimeAudience: 'home-dev';
      signingKeyVersion: string;
      signingKeyMaterial: string;
      evaluatorUserId: string;
      contextEncryptionKeyVersion: string;
      contextEncryptionKeyMaterial: string;
    };

export type IntexAgentTestRunsReadConfig =
  | { enabled: false }
  | {
      enabled: true;
      runtimeAudience: 'home-dev';
      evaluatorUserId: string;
    };

const DISABLED_MATRIX_CORPUS_CONFIG = {
  enabled: false,
  runtimeAudience: 'disabled',
} as const;

export interface ServiceConfig {
  port: number;
  host: string;
  gcpProjectId: string;
  internalAuthToken: string;
  userServiceUrl: string;
  notesAgentUrl: string;
  calendarAgentUrl: string;
  researchAgentUrl: string;
  bookmarksAgentUrl: string;
  codeAgentUrl: string;
  webAppUrl: string;
  llmUsageServiceUrl: string;
  openRouterAppApiKey: string;
  whatsappSendTopic: string;
  sessionTimeoutMs: number;
  matrixCorpus: IntexMatrixCorpusConfig;
  testRunsRead: IntexAgentTestRunsReadConfig;
}

export function parseIntexMatrixCorpusConfig(
  env: Environment = process.env
): IntexMatrixCorpusConfig {
  const enabled = parseEnableFlag(env['INTEXURAOS_MATRIX_CORPUS_ENABLED']);
  if (!enabled) return DISABLED_MATRIX_CORPUS_CONFIG;

  if (env['INTEXURAOS_ENVIRONMENT'] !== 'dev') {
    throw invalidConfig('INTEXURAOS_ENVIRONMENT');
  }
  if (env['INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME'] !== 'home-dev') {
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME');
  }
  if (env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] !== 'home-dev') {
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE');
  }

  const signingKeyVersion = requireCanonicalValue(
    env,
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    64,
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
  );
  const signingKeyMaterial = requireCanonicalValue(
    env,
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
    4096
  );
  assertCanonicalPublicEd25519Jwk(signingKeyMaterial, signingKeyVersion);
  const evaluatorUserId = requireCanonicalValue(
    env,
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    128,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
  );
  const contextEncryptionKeyVersion = requireCanonicalValue(
    env,
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
    64,
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
  );
  const contextEncryptionKeyMaterial = requireCanonicalValue(
    env,
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY',
    43,
    /^[A-Za-z0-9_-]{43}$/u
  );
  assertCanonicalEncryptionKey(contextEncryptionKeyMaterial);

  return {
    enabled: true,
    runtimeAudience: 'home-dev',
    signingKeyVersion,
    signingKeyMaterial,
    evaluatorUserId,
    contextEncryptionKeyVersion,
    contextEncryptionKeyMaterial,
  };
}

export function loadConfig(): ServiceConfig {
  const matrixCorpus = parseIntexMatrixCorpusConfig();
  return {
    port: Number(process.env['PORT'] ?? 8080),
    host: process.env['HOST'] ?? '0.0.0.0',
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    userServiceUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '',
    notesAgentUrl: process.env['INTEXURAOS_NOTES_AGENT_URL'] ?? '',
    calendarAgentUrl: process.env['INTEXURAOS_CALENDAR_AGENT_URL'] ?? '',
    researchAgentUrl: process.env['INTEXURAOS_RESEARCH_AGENT_URL'] ?? '',
    bookmarksAgentUrl: process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'] ?? '',
    codeAgentUrl: process.env['INTEXURAOS_CODE_AGENT_URL'] ?? '',
    webAppUrl: process.env['INTEXURAOS_WEB_APP_URL'] ?? 'https://intexuraos.cloud',
    llmUsageServiceUrl: process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '',
    openRouterAppApiKey: process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '',
    whatsappSendTopic: process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'] ?? '',
    sessionTimeoutMs: Number(
      process.env['INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS'] ?? DEFAULT_SESSION_TIMEOUT_MS
    ),
    matrixCorpus,
    testRunsRead: parseTestRunsReadConfig(process.env, matrixCorpus),
  };
}

function parseTestRunsReadConfig(
  env: Environment,
  matrixCorpus: IntexMatrixCorpusConfig
): IntexAgentTestRunsReadConfig {
  const flag = env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'];
  if (flag !== 'true' && flag !== 'false')
    throw invalidConfig('INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED');
  if (flag === 'false') return { enabled: false };
  if (!matrixCorpus.enabled) throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_ENABLED');
  return {
    enabled: true,
    runtimeAudience: matrixCorpus.runtimeAudience,
    evaluatorUserId: matrixCorpus.evaluatorUserId,
  };
}

function parseEnableFlag(value: string | undefined): boolean {
  const normalized = value?.trim() ?? '';
  if (normalized === '' || normalized === 'false') return false;
  if (normalized === 'true') return true;
  throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_ENABLED');
}

function requireCanonicalValue(
  env: Environment,
  name: string,
  maxLength: number,
  pattern?: RegExp
): string {
  const value = env[name];
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw invalidConfig(name);
  }
  return value;
}

function assertCanonicalPublicEd25519Jwk(material: string, keyVersion: string): void {
  let candidate: unknown;
  try {
    candidate = JSON.parse(material);
  } catch {
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY');
  }
  if (!isPlainRecord(candidate)) {
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY');
  }

  const expectedKeys = ['crv', 'kid', 'kty', 'x'];
  const actualKeys = Object.keys(candidate).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    candidate['kty'] !== 'OKP' ||
    candidate['crv'] !== 'Ed25519' ||
    candidate['kid'] !== keyVersion ||
    !isCanonicalEd25519Component(candidate['x'])
  ) {
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY');
  }
}

function assertCanonicalEncryptionKey(material: string): void {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(material, 'base64url');
  } catch {
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY');
  }
  if (decoded.length !== 32 || decoded.toString('base64url') !== material)
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY');
}

function isCanonicalEd25519Component(value: unknown): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidConfig(fieldName: string): Error {
  return new Error(`${fieldName} is invalid`);
}
