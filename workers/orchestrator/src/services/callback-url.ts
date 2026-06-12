const INTERNAL_MARKER = '/internal/';
const PUBLIC_CODE_AGENT_PREFIX = '/api/code';
const PUBLIC_INTERNAL_PREFIX = `${PUBLIC_CODE_AGENT_PREFIX}/internal/`;
const PUBLIC_CALLBACK_HOSTS = new Set(['intexuraos.cloud', 'dev.intexuraos.cloud']);

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

  if (!PUBLIC_CALLBACK_HOSTS.has(parsed.hostname)) {
    return url;
  }

  if (parsed.pathname.startsWith(PUBLIC_INTERNAL_PREFIX)) {
    return url;
  }

  if (!parsed.pathname.startsWith(INTERNAL_MARKER)) {
    return url;
  }

  if (!isRecognizedInternalCallbackPath(parsed.pathname)) {
    return url;
  }

  parsed.pathname = `${PUBLIC_CODE_AGENT_PREFIX}${parsed.pathname}`;
  return parsed.toString();
}

export function deriveCallbackBaseUrl(
  webhookUrl: string | undefined,
  fallbackBaseUrl: string
): string {
  if (webhookUrl === undefined || webhookUrl === '') {
    return stripTrailingSlashes(fallbackBaseUrl);
  }

  try {
    const parsed = new URL(normalizeInternalCallbackUrl(webhookUrl));
    const markerIndex = parsed.pathname.indexOf(INTERNAL_MARKER);
    if (markerIndex === -1) {
      return stripTrailingSlashes(fallbackBaseUrl);
    }

    parsed.pathname = parsed.pathname.slice(0, markerIndex);
    parsed.search = '';
    parsed.hash = '';
    return stripTrailingSlashes(parsed.toString());
  } catch {
    return stripTrailingSlashes(fallbackBaseUrl);
  }
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
