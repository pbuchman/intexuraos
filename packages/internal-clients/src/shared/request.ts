import { resolvePropagationHeaders } from './propagation.js';

type LogFn = (obj: object, msg?: string) => void;
type RequestBody = RequestInit['body'];

export interface InternalRequestLogger {
  warn: LogFn;
}

export interface InternalRequestConfig {
  baseUrl: string;
  path: string;
  method: string;
  token: string;
  logger: InternalRequestLogger;
  headers?: Record<string, string> | undefined;
  body?: RequestBody | undefined;
  jsonBody?: unknown;
  timeoutMs?: number | undefined;
  requestId?: string | undefined;
  skipSentry?: boolean | undefined;
  privateRequest?: boolean | undefined;
}

export type InternalTransportError =
  | { code: 'TIMEOUT'; message: string }
  | { code: 'NETWORK_ERROR'; message: string };

export type InternalTransportResult =
  | {
      ok: true;
      response: Response;
      body: unknown;
      rawText: string;
    }
  | {
      ok: false;
      error: InternalTransportError;
    };

export async function sendInternalRequest(
  cfg: InternalRequestConfig
): Promise<InternalTransportResult> {
  const timeoutMs = cfg.timeoutMs;
  const controller = new AbortController();
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          controller.abort();
        }, timeoutMs);

  let headers: Record<string, string> = {
    ...(cfg.headers ?? {}),
    'x-internal-auth': cfg.token,
  };

  let body: RequestBody | undefined = cfg.body;
  if (cfg.jsonBody !== undefined) {
    headers['content-type'] ??= 'application/json';
    body = JSON.stringify(cfg.jsonBody);
  }

  headers = resolvePropagationHeaders({
    headers,
    requestId: cfg.requestId,
  });

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}${cfg.path}`;

  try {
    const response = await fetch(url, {
      method: cfg.method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body } : {}),
    });

    let rawText = '';
    let parsedBody: unknown = '';
    if (typeof response.text === 'function') {
      rawText = await response.text();
      parsedBody = rawText;
      if (rawText !== '') {
        try {
          parsedBody = JSON.parse(rawText);
        } catch {
          parsedBody = rawText;
        }
      }
    } else if (typeof response.json === 'function') {
      parsedBody = await response.json();
      rawText = JSON.stringify(parsedBody);
    }

    return {
      ok: true,
      response,
      body: parsedBody,
      rawText,
    };
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string };
    const message = error.message ?? (typeof err === 'string' ? err : 'unknown');
    if (error.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `Request exceeded ${String(timeoutMs)}ms`,
        },
      };
    }

    if (cfg.privateRequest === true) {
      cfg.logger.warn({ _skipSentry: true }, 'private internal-client network error');
    } else {
      cfg.logger.warn(
        {
          url,
          err,
          ...(cfg.skipSentry === true ? { _skipSentry: true } : {}),
        },
        'internal-client network error'
      );
    }
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message,
      },
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
