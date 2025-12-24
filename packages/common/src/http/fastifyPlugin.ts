import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { REQUEST_ID_HEADER, getRequestId } from './requestId.js';
import { ok, fail } from './response.js';
import type { Diagnostics, ApiOk, ApiError } from './response.js';
import type { ErrorCode } from './errors.js';
import { ERROR_HTTP_STATUS } from './errors.js';

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
      return this.status(200).send(response);
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

  done();
};

export const intexuraFastifyPlugin = fp(intexuraPlugin, {
  name: 'intexura-plugin',
  fastify: '5.x',
});
