import { functionOrigin } from './origin.mjs';

const PUBLIC_ORIGIN = 'https://share.intexuraos.cloud';
const SHARE_PATH = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(html|md)$/;
const MIME_TYPES = {
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};
const SHARE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts";
const ERROR_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";

function responseHeaders(contentType, csp) {
  return new Headers({
    'cache-control': 'no-store',
    'content-security-policy': csp,
    'content-type': contentType,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
}

function errorResponse(method, status, message) {
  const headers = responseHeaders('text/plain; charset=utf-8', ERROR_CSP);
  if (status === 405) headers.set('allow', 'GET, HEAD');

  return new Response(method === 'HEAD' ? null : `${message}\n`, { status, headers });
}

function discard(response) {
  void response.body?.cancel().catch(() => {});
}

function isValidShare(response, contentType) {
  const { headers } = response;
  const encoding = headers.get('content-encoding');
  const length = headers.get('content-length');

  return (
    response.status === 200 &&
    !response.redirected &&
    !headers.has('location') &&
    !headers.has('content-range') &&
    (encoding === null || encoding === 'identity') &&
    (length === null || /^\d+$/.test(length)) &&
    headers.get('content-type') === contentType &&
    headers.get('content-security-policy') === SHARE_CSP
  );
}

export default {
  async fetch(request, env) {
    const { method, url } = request;
    if (!url.startsWith(`${PUBLIC_ORIGIN}/`)) return errorResponse(method, 404, 'Not found');
    if (method !== 'GET' && method !== 'HEAD') {
      return errorResponse(method, 405, 'Method not allowed');
    }

    // Use the path as delivered so URL parsing cannot turn a noncanonical path into a valid slug.
    const path = url.slice(PUBLIC_ORIGIN.length).split('?', 1)[0];
    const match = SHARE_PATH.exec(path);
    if (!match || match[0] !== path || match[1].length > 128) {
      return errorResponse(method, 404, 'Not found');
    }

    const origin = functionOrigin(env.FUNCTION_ORIGIN);
    if (!origin) return errorResponse(method, 502, 'Bad gateway');

    let upstream;
    try {
      upstream = await fetch(`${origin}${path}`, {
        method,
        cache: 'no-store',
        redirect: 'manual',
        headers: { 'accept-encoding': 'identity' },
      });
    } catch {
      return errorResponse(method, 502, 'Bad gateway');
    }

    if (upstream.status === 404 || upstream.status === 410) {
      discard(upstream);
      return upstream.status === 404
        ? errorResponse(method, 404, 'Not found')
        : errorResponse(method, 410, 'Gone');
    }

    const contentType = MIME_TYPES[match[2]];
    if (!isValidShare(upstream, contentType)) {
      discard(upstream);
      return errorResponse(method, 502, 'Bad gateway');
    }

    const headers = responseHeaders(contentType, SHARE_CSP);
    if (match[2] === 'md') headers.set('content-disposition', 'attachment');
    const length = upstream.headers.get('content-length');
    if (length !== null) headers.set('content-length', length);
    if (method === 'HEAD') discard(upstream);

    return new Response(method === 'HEAD' ? null : upstream.body, { headers });
  },
};
