import { STATUS_CODES } from 'node:http';

const SHARE_PATH = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(html|md)$/;
const MAX_SLUG_LENGTH = 128;
const MAX_SHARE_BYTES = 16 * 1024 * 1024;
const UTC_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;
const GENERATION = /^[1-9]\d*$/;
const BYTE_COUNT = /^(?:0|[1-9]\d*)$/;
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'sandbox allow-scripts',
].join('; ');

function getCutoff(customTime) {
  if (typeof customTime !== 'string') return undefined;
  const match = UTC_TIME.exec(customTime);
  if (!match || match[0] !== customTime) return undefined;

  const [, seconds, fraction = ''] = match;
  const second = Date.parse(`${seconds}Z`);
  if (!Number.isFinite(second) || new Date(second).toISOString().slice(0, 19) !== seconds) {
    return undefined;
  }

  // Date.now() has millisecond precision. Round up so a fractional millisecond
  // still expires on the first clock tick at or after the cutoff.
  return second + Math.ceil(Number(fraction.padEnd(9, '0')) / 1_000_000);
}

function sendError(response, method, status) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(method === 'HEAD' ? undefined : `${STATUS_CODES[status]}\n`);
}

async function readMedia(media) {
  if (!media.body) return Buffer.alloc(0);

  const reader = media.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, size);

    // Fetch may decompress the body, so its size can exceed Storage's metadata size.
    size += value.byteLength;
    if (size > MAX_SHARE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
}

export function createShareHandler({
  bucket = process.env.SHARE_BUCKET,
  fetch: fetchUpstream = globalThis.fetch,
  now = Date.now,
} = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');

    const { method } = request;
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return sendError(response, method, 405);
    }

    const path = request.originalUrl ?? request.url;
    const match = SHARE_PATH.exec(path);
    if (!match || match[0] !== path || match[1].length > MAX_SLUG_LENGTH) {
      return sendError(response, method, 404);
    }
    if (!bucket) return sendError(response, method, 503);

    const [, slug, extension] = match;
    const contentType =
      extension === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8';
    const object = new URL(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${slug}.${extension}`
    );

    try {
      const options = { redirect: 'error', signal: AbortSignal.timeout(25_000) };
      const tokenResponse = await fetchUpstream(METADATA_TOKEN_URL, {
        ...options,
        headers: { 'Metadata-Flavor': 'Google' },
      });
      if (tokenResponse.status !== 200) {
        await tokenResponse.body?.cancel();
        return sendError(response, method, 503);
      }
      const token = await tokenResponse.json();
      if (typeof token?.access_token !== 'string' || !token.access_token) {
        return sendError(response, method, 503);
      }

      const storageOptions = {
        ...options,
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token.access_token}` },
      };
      const metadataUrl = new URL(object);
      metadataUrl.searchParams.set('fields', 'customTime,generation,metageneration,size');
      const metadataResponse = await fetchUpstream(metadataUrl, storageOptions);
      if (metadataResponse.status !== 200) {
        await metadataResponse.body?.cancel();
        return sendError(response, method, metadataResponse.status === 404 ? 404 : 503);
      }

      const metadata = await metadataResponse.json();
      const cutoff = Object.hasOwn(metadata, 'customTime')
        ? getCutoff(metadata.customTime)
        : Infinity;
      if (cutoff === undefined) return sendError(response, method, 404);
      if (now() >= cutoff) return sendError(response, method, 410);

      const { generation, metageneration, size } = metadata;
      if (
        typeof generation !== 'string' ||
        !GENERATION.test(generation) ||
        typeof metageneration !== 'string' ||
        !GENERATION.test(metageneration) ||
        typeof size !== 'string' ||
        !BYTE_COUNT.test(size)
      ) {
        return sendError(response, method, 503);
      }
      if (Number(size) > MAX_SHARE_BYTES) return sendError(response, method, 404);

      let body;
      if (method === 'GET') {
        // Preconditions apply to the live object. A generation selector would also
        // let a versioned bucket return an object that has since been replaced.
        object.searchParams.set('alt', 'media');
        object.searchParams.set('ifGenerationMatch', generation);
        object.searchParams.set('ifMetagenerationMatch', metageneration);
        const media = await fetchUpstream(object, storageOptions);
        if (media.status !== 200) {
          await media.body?.cancel();
          return sendError(response, method, media.status === 404 ? 404 : 503);
        }
        body = await readMedia(media);
        if (body === undefined) return sendError(response, method, 404);
      }

      if (now() >= cutoff) return sendError(response, method, 410);
      response.statusCode = 200;
      response.setHeader('Content-Type', contentType);
      response.end(body);
    } catch {
      return sendError(response, method, 503);
    }
  };
}

export const serveShare = createShareHandler();
