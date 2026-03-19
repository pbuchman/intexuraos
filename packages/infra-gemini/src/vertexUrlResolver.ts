/**
 * Resolves opaque Vertex AI redirect URLs to their actual destinations.
 *
 * Gemini grounding citations often return URLs like
 * `https://vertexaisearch.cloud.google.com/grounding-api-redirect/...`
 * which redirect to the actual source. This module resolves those
 * redirects via HEAD requests.
 *
 * @packageDocumentation
 */

const VERTEX_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

function isVertexRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === VERTEX_REDIRECT_HOST;
  } catch {
    return false;
  }
}

async function resolveOneUrl(url: string): Promise<string> {
  if (!isVertexRedirectUrl(url)) {
    return url;
  }

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    });

    const location = response.headers.get('location');
    if (location !== null && location !== '') {
      return location;
    }

    return url;
  } catch {
    return url;
  }
}

/**
 * Resolves Vertex AI redirect URLs to their actual destination URLs.
 *
 * For URLs matching the Vertex AI redirect pattern
 * (`vertexaisearch.cloud.google.com`), performs a HEAD request to get
 * the redirect Location header. Non-Vertex URLs are returned unchanged.
 * Falls back to the original URL on any error.
 *
 * @param urls - Array of citation URLs from Gemini grounding metadata
 * @returns Array of resolved URLs in the same order
 */
export async function resolveVertexRedirectUrls(urls: string[]): Promise<string[]> {
  return await Promise.all(urls.map(resolveOneUrl));
}
