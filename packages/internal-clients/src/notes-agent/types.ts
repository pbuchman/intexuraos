import type { NotesCreateNoteRequest } from '@intexuraos/http-contracts';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';
import type { ServiceFeedbackRequestOptions } from '../shared/serviceFeedback.js';

export interface NotesAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export type CreateNoteRequest = NotesCreateNoteRequest;

export type NotesAgentRequestOptions = ServiceFeedbackRequestOptions;

export interface NotesAgentServiceClient {
  createNote(
    request: CreateNoteRequest,
    options?: NotesAgentRequestOptions
  ): Promise<Result<ServiceFeedback>>;
}
