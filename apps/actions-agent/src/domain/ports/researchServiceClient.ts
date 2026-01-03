import type { Result } from '@intexuraos/common-core';
import type { SupportedModel } from '@intexuraos/llm-contract';

export interface ResearchServiceClient {
  createDraft(params: {
    userId: string;
    title: string;
    prompt: string;
    selectedModels: SupportedModel[];
    sourceActionId?: string;
  }): Promise<Result<{ id: string }>>;
}
