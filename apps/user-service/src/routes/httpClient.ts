/**
 * Minimal HTTPS client helper for Auth0 calls.
 * NOTE: Uses Node's https module so test mocks via nock can intercept requests.
 */
import https from 'node:https';

export interface HttpResponse {
  status: number;
  body: unknown;
}

export function toFormUrlEncodedBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function postFormUrlEncoded(url: string, formBody: string): Promise<HttpResponse> {
  return await new Promise<HttpResponse>((resolve, reject) => {
    const parsed = new URL(url);

    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port === '' ? undefined : Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formBody, 'utf8'),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;

          if (raw === '') {
            resolve({ status, body: null });
            return;
          }

          try {
            const parsedBody: unknown = JSON.parse(raw);
            resolve({ status, body: parsedBody });
          } catch {
            resolve({ status, body: { raw } });
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(error);
    });

    req.end(formBody, 'utf8');
  });
}
