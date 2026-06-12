import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
import type {
  GetDigestRequest,
  GetDigestResponse,
  GetDigestStateRequest,
  GetDigestStateResponse,
  ListDigestSubscriptionsRequest,
  ListDigestSubscriptionsResponse,
  MobileNotificationsRequestOptions,
  MobileNotificationsServiceClient,
  MobileNotificationsServiceConfig,
  MobileNotificationsServiceResult,
  QueryDigestsRequest,
  QueryDigestsResponse,
  QueryGroupMessagesRequest,
  QueryGroupMessagesResponse,
} from './types.js';

function withRequestOptions(
  body: unknown,
  path: string,
  options: MobileNotificationsRequestOptions | undefined
): {
  method: 'POST';
  path: string;
  body: unknown;
  requestId?: string;
  timeoutMs?: number;
} {
  return {
    method: 'POST',
    path,
    body,
    ...(options?.requestId !== undefined ? { requestId: options.requestId } : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
}

export function createMobileNotificationsServiceClient(
  config: MobileNotificationsServiceConfig
): MobileNotificationsServiceClient {
  const http = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async listDigestSubscriptions(
      input: ListDigestSubscriptionsRequest,
      options?: MobileNotificationsRequestOptions
    ): Promise<MobileNotificationsServiceResult<ListDigestSubscriptionsResponse>> {
      return await http.request<ListDigestSubscriptionsResponse>(
        withRequestOptions(input, '/internal/notifications/digest-subscriptions/list', options)
      );
    },

    async queryDigests(
      input: QueryDigestsRequest,
      options?: MobileNotificationsRequestOptions
    ): Promise<MobileNotificationsServiceResult<QueryDigestsResponse>> {
      return await http.request<QueryDigestsResponse>(
        withRequestOptions(input, '/internal/notifications/digests/query', options)
      );
    },

    async getDigest(
      input: GetDigestRequest,
      options?: MobileNotificationsRequestOptions
    ): Promise<MobileNotificationsServiceResult<GetDigestResponse>> {
      return await http.request<GetDigestResponse>(
        withRequestOptions(input, '/internal/notifications/digests/get', options)
      );
    },

    async getDigestState(
      input: GetDigestStateRequest,
      options?: MobileNotificationsRequestOptions
    ): Promise<MobileNotificationsServiceResult<GetDigestStateResponse>> {
      return await http.request<GetDigestStateResponse>(
        withRequestOptions(input, '/internal/notifications/digest-state/get', options)
      );
    },

    async queryGroupMessages(
      input: QueryGroupMessagesRequest,
      options?: MobileNotificationsRequestOptions
    ): Promise<MobileNotificationsServiceResult<QueryGroupMessagesResponse>> {
      return await http.request<QueryGroupMessagesResponse>(
        withRequestOptions(input, '/internal/notifications/group-messages/query', options)
      );
    },
  };
}
