import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { postServiceFeedback } from '../shared/serviceFeedback.js';
import type {
  CreateNoteRequest,
  NotesAgentServiceClient,
  NotesAgentServiceConfig,
  NotesAgentRequestOptions,
} from './types.js';

export function createNotesAgentServiceClient(
  config: NotesAgentServiceConfig
): NotesAgentServiceClient {
  return {
    async createNote(
      request: CreateNoteRequest,
      options?: NotesAgentRequestOptions
    ): Promise<Result<ServiceFeedback>> {
      return await postServiceFeedback(config, {
        path: '/internal/notes',
        body: request,
        options,
        invalidJsonMessage: 'Invalid response from notes-agent',
        invalidEnvelopeMessage: 'Invalid response from notes-agent',
        networkErrorPrefix: 'Failed to call notes-agent',
        getDefaultHttpErrorMessage: (response) =>
          `HTTP ${String(response.status)}: ${response.statusText}`,
      });
    },
  };
}
