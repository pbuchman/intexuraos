export interface ProductionHealthResponseInput {
  status: number;
  headers: Headers | Readonly<Record<string, string | undefined>>;
  body: string;
}

export class ProductionHealthContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProductionHealthContractError';
    this.code = code;
  }
}

function headerValue(
  headers: ProductionHealthResponseInput['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return value;
  }
  return undefined;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

export function validateCodeAgentHealthResponse(
  input: ProductionHealthResponseInput,
): Record<string, unknown> {
  if (!Number.isInteger(input.status) || input.status < 200 || input.status >= 300) {
    throw new ProductionHealthContractError('HEALTH_HTTP_STATUS_INVALID');
  }
  const contentType = headerValue(input.headers, 'content-type')?.toLowerCase() ?? '';
  if (!/^application\/json(?:\s*;|$)/u.test(contentType)) {
    throw new ProductionHealthContractError('HEALTH_CONTENT_TYPE_INVALID');
  }
  const cacheControl = headerValue(input.headers, 'cache-control')?.toLowerCase() ?? '';
  if (!cacheControl.split(',').some((directive) => directive.trim() === 'no-store')) {
    throw new ProductionHealthContractError('HEALTH_CACHE_CONTROL_INVALID');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body) as unknown;
  } catch {
    throw new ProductionHealthContractError('HEALTH_JSON_INVALID');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProductionHealthContractError('HEALTH_JSON_INVALID');
  }
  const body = parsed as Record<string, unknown>;
  if (body['status'] !== 'ok') {
    throw new ProductionHealthContractError('HEALTH_STATUS_INVALID');
  }
  if (body['serviceName'] !== 'code-agent') {
    throw new ProductionHealthContractError('HEALTH_SERVICE_NAME_INVALID');
  }
  if (typeof body['version'] !== 'string' || body['version'].trim() === '') {
    throw new ProductionHealthContractError('HEALTH_VERSION_INVALID');
  }
  if (!isCanonicalTimestamp(body['timestamp'])) {
    throw new ProductionHealthContractError('HEALTH_TIMESTAMP_INVALID');
  }
  if (!Array.isArray(body['checks']) || body['checks'].length === 0) {
    throw new ProductionHealthContractError('HEALTH_CHECKS_EMPTY');
  }
  let firestoreOk = false;
  for (const check of body['checks']) {
    if (typeof check !== 'object' || check === null || Array.isArray(check)) {
      throw new ProductionHealthContractError('HEALTH_CHECK_INVALID');
    }
    const record = check as Record<string, unknown>;
    if (
      typeof record['name'] !== 'string'
      || record['name'].trim() === ''
      || record['status'] !== 'ok'
      || typeof record['latencyMs'] !== 'number'
      || !Number.isFinite(record['latencyMs'])
      || record['latencyMs'] < 0
    ) {
      throw new ProductionHealthContractError('HEALTH_CHECK_INVALID');
    }
    if (record['name'] === 'firestore') firestoreOk = true;
  }
  if (!firestoreOk) {
    throw new ProductionHealthContractError('HEALTH_FIRESTORE_REQUIRED');
  }
  return body;
}
