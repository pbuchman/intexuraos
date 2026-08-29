const INTERNAL_MARKER = '/internal/';
const PUBLIC_CODE_AGENT_PREFIX = '/api/code';
const PUBLIC_INTERNAL_PREFIX = `${PUBLIC_CODE_AGENT_PREFIX}/internal/`;
const PUBLIC_CALLBACK_HOSTS = new Set(['intexuraos.cloud', 'dev.intexuraos.cloud']);

function canonicalizePublicCallbackHost(parsed: URL): boolean {
  const canonicalHostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!PUBLIC_CALLBACK_HOSTS.has(canonicalHostname)) {
    return false;
  }
  parsed.hostname = canonicalHostname;
  return true;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function isRecognizedInternalCallbackPath(pathname: string): boolean {
  if (pathname === '/internal/logs') return true;
  if (pathname === '/internal/turn-metrics') return true;
  if (pathname === '/internal/webhooks/task-complete') return true;
  if (pathname === '/internal/webhooks/task-event') return true;
  return /^\/internal\/code-tasks\/[^/]+\/status$/.test(pathname);
}

export function normalizeInternalCallbackUrl(url: string): string {
  const parsed = new URL(url);

  if (!canonicalizePublicCallbackHost(parsed)) {
    return url;
  }

  if (parsed.pathname.startsWith(PUBLIC_INTERNAL_PREFIX)) {
    return parsed.toString();
  }

  if (!parsed.pathname.startsWith(INTERNAL_MARKER)) {
    return parsed.toString();
  }

  if (!isRecognizedInternalCallbackPath(parsed.pathname)) {
    return parsed.toString();
  }

  parsed.pathname = `${PUBLIC_CODE_AGENT_PREFIX}${parsed.pathname}`;
  return parsed.toString();
}

export function deriveCallbackBaseUrl(
  webhookUrl: string | undefined,
  fallbackBaseUrl: string
): string {
  if (webhookUrl === undefined) {
    return stripTrailingSlashes(fallbackBaseUrl);
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizeInternalCallbackUrl(webhookUrl));
  } catch {
    throw new Error('Task webhook URL is present but invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Task webhook URL is present but invalid');
  }

  const markerIndex = parsed.pathname.indexOf(INTERNAL_MARKER);
  if (markerIndex === -1) {
    const ownerBase = canonicalizePublicCallbackHost(parsed)
      ? `${parsed.origin}${PUBLIC_CODE_AGENT_PREFIX}`
      : parsed.origin;
    return stripTrailingSlashes(ownerBase);
  }

  parsed.pathname = parsed.pathname.slice(0, markerIndex);
  parsed.search = '';
  parsed.hash = '';
  return stripTrailingSlashes(parsed.toString());
}

export function buildTaskCallbackUrl(
  webhookUrl: string | undefined,
  fallbackBaseUrl: string,
  path: string
): string {
  const baseUrl = deriveCallbackBaseUrl(webhookUrl, fallbackBaseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export function buildRequiredTaskCallbackUrl(webhookUrl: string, path: string): string {
  if (typeof webhookUrl !== 'string' || webhookUrl === '') {
    throw new Error('Required task webhook URL is missing');
  }
  return buildTaskCallbackUrl(webhookUrl, 'http://invalid-required-callback', path);
}
