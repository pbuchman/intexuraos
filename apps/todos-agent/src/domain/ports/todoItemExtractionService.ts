/**
 * Port interface for todo item extraction service.
 * Domain layer defines this interface; infra layer implements it.
 */

import type { Result } from '@intexuraos/common-core';

export interface ExtractionError {
  code: 'NO_API_KEY' | 'USER_SERVICE_ERROR' | 'GENERATION_ERROR' | 'INVALID_RESPONSE';
  message: string;
  details?: {
    llmErrorCode?: string;
    parseError?: string;
    rawResponsePreview?: string | undefined;
    userServiceError?: string;
    wasWrappedInMarkdown?: boolean;
    originalLength?: number;
    cleanedLength?: number;
  };
}

export interface ExtractedItem {
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  dueDate: Date | null;
  reasoning: string;
}

export interface TodoItemExtractionService {
  extractItems(userId: string, description: string): Promise<Result<ExtractedItem[], ExtractionError>>;
}
