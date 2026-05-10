import { err, ok, type Result, type ServiceFeedback } from '@intexuraos/common-core';
import { sendInternalRequest } from './request.js';

type LogFn = (obj: object, msg?: string) => void;

interface ServiceFeedbackLogger {
  warn: LogFn;
}

export interface ServiceFeedbackClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: ServiceFeedbackLogger;
  defaultTimeoutMs?: number;
}

export interface ServiceFeedbackRequestOptions {
  requestId?: string;
  timeoutMs?: number;
}

interface ServiceFeedbackEnvelope {
  success: boolean;
  data?: ServiceFeedback;
  error?: {
    code?: string;
    message?: string;
  };
}

interface ServiceFeedbackRequest<TRequest> {
  path: string;
  body: TRequest;
  options?: ServiceFeedbackRequestOptions | undefined;
  invalidJsonMessage: string;
  invalidEnvelopeMessage: string;
  networkErrorPrefix: string;
  getDefaultHttpErrorMessage: (response: Response) => string;
}

function isEnvelope(body: unknown): body is ServiceFeedbackEnvelope {
  return body !== null && typeof body === 'object' && 'success' in body;
}

function readErrorDetails(body: unknown): {
  code?: string;
  message?: string;
} {
  if (body === null || typeof body !== 'object' || !('error' in body)) {
    return {};
  }

  const error = body.error;
  if (error === null || typeof error !== 'object') {
    return {};
  }
  const errorRecord = error as { code?: unknown; message?: unknown };

  return {
    ...(typeof errorRecord.code === 'string' ? { code: errorRecord.code } : {}),
    ...(typeof errorRecord.message === 'string' ? { message: errorRecord.message } : {}),
  };
}

export async function postServiceFeedback<TRequest>(
  config: ServiceFeedbackClientConfig,
  request: ServiceFeedbackRequest<TRequest>
): Promise<Result<ServiceFeedback>> {
  const transport = await sendInternalRequest({
    baseUrl: config.baseUrl,
    path: request.path,
    method: 'POST',
    token: config.internalAuthToken,
    logger: config.logger,
    jsonBody: request.body,
    timeoutMs: request.options?.timeoutMs ?? config.defaultTimeoutMs,
    requestId: request.options?.requestId,
  });

  if (!transport.ok) {
    return err(new Error(`${request.networkErrorPrefix}: ${transport.error.message}`));
  }

  const { response, body } = transport;
  if (!response.ok) {
    if (body === null || typeof body !== 'object') {
      return err(new Error(request.getDefaultHttpErrorMessage(response)));
    }
    const errorDetails = readErrorDetails(body);
    const message = errorDetails.message ?? request.getDefaultHttpErrorMessage(response);
    return ok({
      status: 'failed',
      message,
      ...(errorDetails.code !== undefined ? { errorCode: errorDetails.code } : {}),
    });
  }

  if (!isEnvelope(body)) {
    return err(new Error(request.invalidJsonMessage));
  }

  if (!body.success || body.data === undefined) {
    return err(new Error(body.error?.message ?? request.invalidEnvelopeMessage));
  }

  return ok({
    status: body.data.status,
    message: body.data.message,
    ...(body.data.resourceUrl !== undefined ? { resourceUrl: body.data.resourceUrl } : {}),
    ...(body.data.errorCode !== undefined ? { errorCode: body.data.errorCode } : {}),
  });
}
