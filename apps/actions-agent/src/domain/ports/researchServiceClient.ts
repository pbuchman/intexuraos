import type { Result, ServiceFeedback } from '@intexuraos/common-core';

export interface ResearchServiceClient {
  createDraft(params: {
    userId: string;
    title: string;
    prompt: string;
    originalMessage: string;
    sourceActionId?: string;
  }): Promise<Result<ServiceFeedback>>;
}
