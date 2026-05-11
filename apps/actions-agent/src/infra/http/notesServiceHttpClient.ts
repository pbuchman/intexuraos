import { createNotesAgentServiceClient } from '@intexuraos/internal-clients';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type {
  NotesServiceClient,
  CreateNoteRequest,
} from '../../domain/ports/notesServiceClient.js';
import type { Logger } from 'pino';

export interface NotesServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

export function createNotesServiceHttpClient(
  config: NotesServiceHttpClientConfig
): NotesServiceClient {
  const client = createNotesAgentServiceClient(config);

  return {
    async createNote(request: CreateNoteRequest): Promise<Result<ServiceFeedback>> {
      return await client.createNote(request);
    },
  };
}
