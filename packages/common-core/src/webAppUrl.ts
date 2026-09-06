export const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';

export function normalizeWebAppUrl(webAppUrl: string): string {
  return webAppUrl.trim().replace(/\/+$/, '');
}

export function resolveWebAppUrl(webAppUrl?: string): string {
  if (webAppUrl === undefined || webAppUrl.trim() === '') {
    return DEFAULT_WEB_APP_URL;
  }

  return normalizeWebAppUrl(webAppUrl);
}

export function buildWebAppHashUrl(hashRoute: string, webAppUrl?: string): string {
  const route = hashRoute.startsWith('/') ? hashRoute : `/${hashRoute}`;
  return `${resolveWebAppUrl(webAppUrl)}${route}`;
}
