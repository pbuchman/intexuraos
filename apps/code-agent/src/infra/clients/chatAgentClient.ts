import { ok, type Result } from '@intexuraos/common-core';
import { fetchWithAuth, type ServiceClientConfig, type ServiceClientError } from '@intexuraos/internal-clients';

export interface ChatSystemEventRequest {
  userId: string;
  source: string;
  eventId: string;
  threadKey: string;
  kind: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ChatSystemEventResult {
  delivered: boolean;
  duplicate: boolean;
}

export interface ChatAgentClient {
  emitSystemEvent(
    request: ChatSystemEventRequest
  ): Promise<Result<ChatSystemEventResult, ServiceClientError>>;
}

export function createChatAgentClient(config: ServiceClientConfig): ChatAgentClient {
  return {
    async emitSystemEvent(
      request: ChatSystemEventRequest
    ): Promise<Result<ChatSystemEventResult, ServiceClientError>> {
      const response = await fetchWithAuth<{ data: ChatSystemEventResult }>(
        config,
        '/internal/chat/events',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }
      );

      /* v8 ignore start -- upstream: fetchWithAuth error path, covered by internal-clients tests @preserve */
      if (!response.ok) {
        return response;
      }
      /* v8 ignore stop @preserve */

      return ok(response.value.data);
    },
  };
}
