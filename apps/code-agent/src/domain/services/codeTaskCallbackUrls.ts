const TASK_COMPLETE_PATH = '/internal/webhooks/task-complete';
const TASK_EVENT_PATH = '/internal/webhooks/task-event';
const PUBLIC_CODE_AGENT_PATH = '/api/code';
const PUBLIC_CALLBACK_HOSTS = new Set(['intexuraos.cloud', 'dev.intexuraos.cloud']);

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizePublicCallbackBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const strippedPath = stripTrailingSlashes(parsed.pathname);

  if (!PUBLIC_CALLBACK_HOSTS.has(parsed.hostname)) {
    return stripTrailingSlashes(baseUrl);
  }

  if (strippedPath === '' || strippedPath === '/') {
    parsed.pathname = PUBLIC_CODE_AGENT_PATH;
    return stripTrailingSlashes(parsed.toString());
  }

  if (strippedPath === PUBLIC_CODE_AGENT_PATH) {
    parsed.pathname = PUBLIC_CODE_AGENT_PATH;
    return stripTrailingSlashes(parsed.toString());
  }

  return stripTrailingSlashes(baseUrl);
}

export function normalizeCallbackBaseUrl(baseUrl: string): string {
  return normalizePublicCallbackBaseUrl(stripTrailingSlashes(baseUrl));
}

export function buildInternalCallbackUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeCallbackBaseUrl(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function buildTaskCompleteWebhookUrl(baseUrl: string): string {
  return buildInternalCallbackUrl(baseUrl, TASK_COMPLETE_PATH);
}

export function buildTaskEventWebhookUrl(baseUrl: string): string {
  return buildInternalCallbackUrl(baseUrl, TASK_EVENT_PATH);
}
