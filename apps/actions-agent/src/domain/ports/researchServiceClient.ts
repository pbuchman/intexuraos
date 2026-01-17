import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { ResearchModel } from '@intexuraos/llm-contract';

export interface ResearchServiceClient {
  createDraft(params: {
    userId: string;
    title: string;
    prompt: string;
    selectedModels: ResearchModel[];
    sourceActionId?: string;
  }): Promise<Result<ServiceFeedback>>;
}
