const INTERNAL_MARKER = '/internal/';
const PROD_HOST = 'intexuraos.cloud';
const PROD_PUBLIC_INTERNAL_PREFIX = '/api/code/internal/';

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
  if (parsed.hostname !== PROD_HOST || !parsed.pathname.startsWith(PROD_PUBLIC_INTERNAL_PREFIX)) {
    return url;
  }

  const normalizedPath = `/internal/${parsed.pathname.slice(PROD_PUBLIC_INTERNAL_PREFIX.length)}`;
  if (!isRecognizedInternalCallbackPath(normalizedPath)) {
    return url;
  }

  parsed.pathname = normalizedPath;
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
