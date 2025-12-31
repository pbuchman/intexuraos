import type { Result } from '@intexuraos/common-core';
import type { LlmProvider } from '../models/actionEvent.js';

export interface ResearchServiceClient {
  createDraft(params: {
    userId: string;
    title: string;
    prompt: string;
    selectedLlms: LlmProvider[];
    sourceActionId?: string;
  }): Promise<Result<{ id: string }>>;
}
