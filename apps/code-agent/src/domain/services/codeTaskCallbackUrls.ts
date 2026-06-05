const TASK_COMPLETE_PATH = '/internal/webhooks/task-complete';
const TASK_EVENT_PATH = '/internal/webhooks/task-event';

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function assertValidInternalCallbackUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname === 'intexuraos.cloud' && parsed.pathname.startsWith('/api/code/internal')) {
    throw new Error(`Invalid production code-task callback URL: ${url} contains /api/code/internal`);
  }
}

export function normalizeCallbackBaseUrl(baseUrl: string): string {
  return stripTrailingSlashes(baseUrl);
}

export function buildInternalCallbackUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeCallbackBaseUrl(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${normalizedBase}${normalizedPath}`;
  assertValidInternalCallbackUrl(url);
  return url;
}

export function buildTaskCompleteWebhookUrl(baseUrl: string): string {
  return buildInternalCallbackUrl(baseUrl, TASK_COMPLETE_PATH);
}

export function buildTaskEventWebhookUrl(baseUrl: string): string {
  return buildInternalCallbackUrl(baseUrl, TASK_EVENT_PATH);
}
