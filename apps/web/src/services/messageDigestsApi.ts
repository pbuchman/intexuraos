import { config } from '@/config';
import type {
  ConfirmMessageDigestRunResponse,
  CreateMessageDigestInput,
  CreateMessageDigestResponse,
  ListMessageDigestRunsOptions,
  ListMessageDigestRunsResponse,
  ListMessageDigestsOptions,
  ListMessageDigestsResponse,
  MessageDigestDefinition,
  MessageDigestDeliveryReadiness,
  MessageDigestErasure,
  MessageDigestPreview,
  MessageDigestRun,
  MessageDigestRunPreparation,
  MessageDigestSchedule,
  MessageDigestSchedulePreview,
  PreviewMessageDigestInput,
  RetryMessageDigestRunResponse,
  ResolveLegacyMessageDigestRunResponse,
  UpdateMessageDigestCommand,
} from '@/types/messageDigests';
import { apiRequest, type RequestOptions } from './apiClient.js';

const MESSAGE_DIGESTS_PATH = '/';

export type MessageDigestRequestOptions = Pick<RequestOptions, 'refreshToken' | 'signal'>;

function addOptionalParam(
  params: URLSearchParams,
  name: string,
  value: string | number | undefined
): void {
  if (value !== undefined) params.set(name, String(value));
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? path : `${path}?${query}`;
}

function getPath(definitionId: string): string {
  return `${MESSAGE_DIGESTS_PATH}${encodeURIComponent(definitionId)}`;
}

function mergeOptions(
  options: RequestOptions,
  requestOptions: MessageDigestRequestOptions | undefined
): RequestOptions {
  return requestOptions === undefined ? options : { ...options, ...requestOptions };
}

async function getRequest<T>(
  path: string,
  accessToken: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<T> {
  if (requestOptions === undefined) {
    return await apiRequest<T>(config.messageDigestServiceUrl, path, accessToken);
  }
  return await apiRequest<T>(config.messageDigestServiceUrl, path, accessToken, requestOptions);
}

export async function listMessageDigests(
  accessToken: string,
  options: ListMessageDigestsOptions = {},
  requestOptions?: MessageDigestRequestOptions
): Promise<ListMessageDigestsResponse> {
  const params = new URLSearchParams();
  addOptionalParam(params, 'cursor', options.cursor);
  addOptionalParam(params, 'limit', options.limit);
  addOptionalParam(params, 'query', options.query);
  addOptionalParam(params, 'chatType', options.chatType);
  addOptionalParam(params, 'status', options.status);
  addOptionalParam(params, 'sort', options.sort);
  addOptionalParam(params, 'direction', options.direction);
  return await getRequest<ListMessageDigestsResponse>(
    withQuery(MESSAGE_DIGESTS_PATH, params),
    accessToken,
    requestOptions
  );
}

export async function createMessageDigest(
  accessToken: string,
  input: CreateMessageDigestInput,
  requestId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<CreateMessageDigestResponse> {
  return await apiRequest<CreateMessageDigestResponse>(
    config.messageDigestServiceUrl,
    MESSAGE_DIGESTS_PATH,
    accessToken,
    mergeOptions(
      {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': requestId },
      },
      requestOptions
    )
  );
}

export async function getMessageDigest(
  accessToken: string,
  definitionId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestDefinition> {
  const response = await getRequest<{ definition: MessageDigestDefinition }>(
    getPath(definitionId),
    accessToken,
    requestOptions
  );
  return response.definition;
}

export async function updateMessageDigest(
  accessToken: string,
  definitionId: string,
  command: UpdateMessageDigestCommand,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestDefinition> {
  const response = await apiRequest<{ definition: MessageDigestDefinition }>(
    config.messageDigestServiceUrl,
    getPath(definitionId),
    accessToken,
    mergeOptions({ method: 'PATCH', body: command }, requestOptions)
  );
  return response.definition;
}

export async function getMessageDigestDeliveryReadiness(
  accessToken: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestDeliveryReadiness> {
  const response = await getRequest<{ readiness: MessageDigestDeliveryReadiness }>(
    `${MESSAGE_DIGESTS_PATH}delivery-readiness`,
    accessToken,
    requestOptions
  );
  return response.readiness;
}

export async function previewMessageDigestSchedule(
  accessToken: string,
  input: { schedule: MessageDigestSchedule; evaluatedAt?: string },
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestSchedulePreview> {
  const response = await apiRequest<{ preview: MessageDigestSchedulePreview }>(
    config.messageDigestServiceUrl,
    `${MESSAGE_DIGESTS_PATH}schedule-preview`,
    accessToken,
    mergeOptions({ method: 'POST', body: input }, requestOptions)
  );
  return response.preview;
}

export async function previewMessageDigest(
  accessToken: string,
  input: PreviewMessageDigestInput,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestPreview> {
  const response = await apiRequest<{ preview: MessageDigestPreview }>(
    config.messageDigestServiceUrl,
    `${MESSAGE_DIGESTS_PATH}preview`,
    accessToken,
    mergeOptions({ method: 'POST', body: input, timeout: 90_000 }, requestOptions)
  );
  return response.preview;
}

export async function prepareMessageDigestRun(
  accessToken: string,
  definitionId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestRunPreparation> {
  const response = await apiRequest<{ preparation: MessageDigestRunPreparation }>(
    config.messageDigestServiceUrl,
    `${getPath(definitionId)}/run/prepare`,
    accessToken,
    mergeOptions({ method: 'POST' }, requestOptions)
  );
  return response.preparation;
}

export async function confirmMessageDigestRun(
  accessToken: string,
  definitionId: string,
  preparationToken: string,
  requestId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<ConfirmMessageDigestRunResponse> {
  return await apiRequest<ConfirmMessageDigestRunResponse>(
    config.messageDigestServiceUrl,
    `${getPath(definitionId)}/run`,
    accessToken,
    mergeOptions(
      {
        method: 'POST',
        body: { preparationToken },
        headers: { 'Idempotency-Key': requestId },
      },
      requestOptions
    )
  );
}

export async function listMessageDigestRuns(
  accessToken: string,
  definitionId: string,
  options: ListMessageDigestRunsOptions = {},
  requestOptions?: MessageDigestRequestOptions
): Promise<ListMessageDigestRunsResponse> {
  const params = new URLSearchParams();
  addOptionalParam(params, 'cursor', options.cursor);
  addOptionalParam(params, 'limit', options.limit);
  addOptionalParam(params, 'fromDate', options.fromDate);
  addOptionalParam(params, 'toDate', options.toDate);
  addOptionalParam(params, 'generationStatus', options.generationStatus);
  addOptionalParam(params, 'deliveryStatus', options.deliveryStatus);
  addOptionalParam(params, 'sort', options.sort);
  addOptionalParam(params, 'direction', options.direction);
  return await getRequest<ListMessageDigestRunsResponse>(
    withQuery(`${getPath(definitionId)}/runs`, params),
    accessToken,
    requestOptions
  );
}

export async function getMessageDigestRun(
  accessToken: string,
  definitionId: string,
  runId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestRun> {
  const response = await getRequest<{ run: MessageDigestRun }>(
    `${getPath(definitionId)}/runs/${encodeURIComponent(runId)}`,
    accessToken,
    requestOptions
  );
  return response.run;
}

export async function retryMessageDigestRun(
  accessToken: string,
  definitionId: string,
  runId: string,
  requestId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<RetryMessageDigestRunResponse> {
  return await apiRequest<RetryMessageDigestRunResponse>(
    config.messageDigestServiceUrl,
    `${getPath(definitionId)}/runs/${encodeURIComponent(runId)}/retry`,
    accessToken,
    mergeOptions(
      { method: 'POST', headers: { 'Idempotency-Key': requestId } },
      requestOptions
    )
  );
}

export async function resolveLegacyMessageDigestRun(
  accessToken: string,
  groupKey: string,
  date: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<ResolveLegacyMessageDigestRunResponse> {
  return await getRequest<ResolveLegacyMessageDigestRunResponse>(
    `${MESSAGE_DIGESTS_PATH}legacy-runs/${encodeURIComponent(groupKey)}/${encodeURIComponent(date)}`,
    accessToken,
    requestOptions
  );
}

export async function deleteMessageDigest(
  accessToken: string,
  definitionId: string,
  requestId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestErasure> {
  const response = await apiRequest<{ erasure: MessageDigestErasure }>(
    config.messageDigestServiceUrl,
    getPath(definitionId),
    accessToken,
    mergeOptions(
      { method: 'DELETE', headers: { 'Idempotency-Key': requestId } },
      requestOptions
    )
  );
  return response.erasure;
}

export async function getMessageDigestErasure(
  accessToken: string,
  erasureRequestId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestErasure> {
  const response = await getRequest<{ erasure: MessageDigestErasure }>(
    `${MESSAGE_DIGESTS_PATH}erasures/${encodeURIComponent(erasureRequestId)}`,
    accessToken,
    requestOptions
  );
  return response.erasure;
}

export async function resumeMessageDigestErasure(
  accessToken: string,
  erasureRequestId: string,
  requestOptions?: MessageDigestRequestOptions
): Promise<MessageDigestErasure> {
  const response = await apiRequest<{ erasure: MessageDigestErasure }>(
    config.messageDigestServiceUrl,
    `${MESSAGE_DIGESTS_PATH}erasures/${encodeURIComponent(erasureRequestId)}/resume`,
    accessToken,
    mergeOptions({ method: 'POST' }, requestOptions)
  );
  return response.erasure;
}
