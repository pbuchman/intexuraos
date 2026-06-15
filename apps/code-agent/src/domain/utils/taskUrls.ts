const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';

export function normalizeWebAppUrl(webAppUrl: string): string {
  return webAppUrl.endsWith('/') ? webAppUrl.slice(0, -1) : webAppUrl;
}

export function resolveConfiguredWebAppUrl(): string {
  const configuredWebUrl = process.env['INTEXURAOS_WEB_APP_URL'];
  return configuredWebUrl !== undefined && configuredWebUrl.length > 0
    ? configuredWebUrl
    : DEFAULT_WEB_APP_URL;
}

export function buildCodeTaskUrl(
  taskId: string,
  webAppUrl: string = resolveConfiguredWebAppUrl()
): string {
  const baseUrl = webAppUrl.length > 0 ? webAppUrl : DEFAULT_WEB_APP_URL;
  return `${normalizeWebAppUrl(baseUrl)}/#/code-tasks/${taskId}`;
}
