import { z } from 'zod';

const MatrixUserIdSchema = z
  .string()
  .min(4)
  .max(255)
  .regex(/^@[^\s:]+:[^\s]+$/u);

const MatrixWhoAmISchema = z
  .object({
    user_id: MatrixUserIdSchema,
    device_id: z.string().min(1).optional(),
    is_guest: z.boolean().optional(),
  })
  .strict();

export type MatrixWhoAmIResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason: 'unauthorized' | 'timeout' | 'unavailable' | 'invalid_response';
    };

export interface MatrixClient {
  whoAmI(input: { homeserverUrl: string; accessToken: string }): Promise<MatrixWhoAmIResult>;
}

export interface MatrixClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const MATRIX_WHOAMI_TIMEOUT_MS = 10_000;
const MATRIX_JSON_MAX_BYTES = 64 * 1024;

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType !== null && /^application\/json(?:\s*;|$)/iu.test(contentType.trim());
}

async function readBoundedBody(
  response: Response,
  maxBytes: number
): Promise<Uint8Array | undefined> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      return undefined;
    }
  }

  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        const body = new Uint8Array(totalBytes);
        let offset = 0;
        for (const part of chunks) {
          body.set(part, offset);
          offset += part.byteLength;
        }
        return body;
      }

      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        return undefined;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function buildWhoAmIUrl(homeserverUrl: string): string | undefined {
  try {
    return new URL('/_matrix/client/v3/account/whoami', homeserverUrl).toString();
  } catch {
    return undefined;
  }
}

export function createMatrixClient(options: MatrixClientOptions = {}): MatrixClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? MATRIX_WHOAMI_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MATRIX_JSON_MAX_BYTES;

  return {
    async whoAmI(input): Promise<MatrixWhoAmIResult> {
      const url = buildWhoAmIUrl(input.homeserverUrl);
      if (url === undefined) {
        return { ok: false, reason: 'invalid_response' };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${input.accessToken}`,
          },
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.status === 401) {
          return { ok: false, reason: 'unauthorized' };
        }
        if (response.status !== 200) {
          return { ok: false, reason: 'unavailable' };
        }
        if (!isJsonResponse(response)) {
          return { ok: false, reason: 'invalid_response' };
        }

        const body = await readBoundedBody(response, maxBytes);
        if (body === undefined) {
          return { ok: false, reason: 'invalid_response' };
        }

        let raw: unknown;
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
          raw = JSON.parse(text) as unknown;
        } catch {
          return { ok: false, reason: 'invalid_response' };
        }
        const parsed = MatrixWhoAmISchema.safeParse(raw);
        return parsed.success
          ? { ok: true, userId: parsed.data.user_id }
          : { ok: false, reason: 'invalid_response' };
      } catch {
        return {
          ok: false,
          reason: controller.signal.aborted ? 'timeout' : 'unavailable',
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
