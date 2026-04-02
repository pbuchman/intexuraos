import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getRequestId, REQUEST_ID_HEADER } from './requestId.js';
import type { ApiError, ApiOk, Diagnostics } from './response.js';
import { fail, ok } from './response.js';
import type { ErrorCode } from '@intexuraos/common-core';
import { ERROR_HTTP_STATUS } from '@intexuraos/common-core';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    startTime: number;
  }

  interface FastifyReply {
    ok: (data: unknown, diagnostics?: Partial<Diagnostics>) => FastifyReply;
    fail: (
      code: ErrorCode,
      message: string,
      diagnostics?: Partial<Diagnostics>,
      details?: unknown
    ) => FastifyReply;
  }
}

const intexuraPlugin: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts: Record<string, unknown>,
  done: (err?: Error) => void
): void => {
  // Override the default JSON parser to accept empty bodies (defaulting to null).
  // Fastify's built-in parser throws FST_ERR_CTP_EMPTY_JSON_BODY on empty body
  // with Content-Type: application/json, which breaks bodyless POST endpoints
  // (e.g. cron triggers). Routes that require a body use schema validation.
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (
      request: FastifyRequest,
      body: string,
      parseComplete: (err: Error | null, result?: unknown) => void
    ): void => {
      // Store raw body for services that need it (e.g. webhook signature validation)
      (request as unknown as { rawBody: string }).rawBody = body;

      if (body === '') {
        parseComplete(null, null);
        return;
      }
      try {
        parseComplete(null, JSON.parse(body));
      } catch (error) {
        // Tag the error so the error handler below can identify it as a 400.
        // Fastify only sets FST_ERR_CTP_INVALID_JSON_BODY on its built-in parser,
        // not on errors forwarded from custom parsers via parseComplete(err).
        const parseError = error as Error & { code?: string; statusCode?: number };
        parseError.code = 'FST_ERR_CTP_INVALID_JSON_BODY';
        parseError.statusCode = 400;
        parseComplete(parseError);
      }
    }
  );

  fastify.addHook(
    'onRequest',
    (request: FastifyRequest, _reply: FastifyReply, hookDone: (err?: Error) => void): void => {
      request.startTime = Date.now();
      request.requestId = getRequestId(
        request.headers as Record<string, string | string[] | undefined>
      );
      hookDone();
    }
  );

  fastify.addHook(
    'onSend',
    (
      request: FastifyRequest,
      reply: FastifyReply,
      _payload: unknown,
      hookDone: (err?: Error) => void
    ): void => {
      void reply.header(REQUEST_ID_HEADER, request.requestId);
      hookDone();
    }
  );

  fastify.decorateReply(
    'ok',
    function (this: FastifyReply, data: unknown, diagnostics?: Partial<Diagnostics>): FastifyReply {
      const request = this.request;
      const fullDiagnostics: Diagnostics = {
        requestId: request.requestId,
        durationMs: Date.now() - request.startTime,
        ...diagnostics,
      };
      const response: ApiOk<unknown> = ok(data, fullDiagnostics);
      return this.send(response);
    }
  );

  fastify.decorateReply(
    'fail',
    function (
      this: FastifyReply,
      code: ErrorCode,
      message: string,
      diagnostics?: Partial<Diagnostics>,
      details?: unknown
    ): FastifyReply {
      const request = this.request;
      const fullDiagnostics: Diagnostics = {
        requestId: request.requestId,
        durationMs: Date.now() - request.startTime,
        ...diagnostics,
      };
      const response: ApiError = fail(code, message, fullDiagnostics, details);
      return this.status(ERROR_HTTP_STATUS[code]).send(response);
    }
  );

  fastify.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply): void => {
    void reply.fail('NOT_FOUND', 'Route not found');
  });

  done();
};

export const intexuraFastifyPlugin = fp(intexuraPlugin, {
  name: 'intexura-plugin',
  fastify: '5.x',
});
