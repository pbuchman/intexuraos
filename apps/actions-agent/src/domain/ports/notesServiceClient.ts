import type { Result, ServiceFeedback } from '@intexuraos/common-core';

export interface CreateNoteRequest {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
}

export interface NotesServiceClient {
  createNote(request: CreateNoteRequest): Promise<Result<ServiceFeedback>>;
}
