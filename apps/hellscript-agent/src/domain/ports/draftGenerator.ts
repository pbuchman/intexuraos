import type { Result } from '@intexuraos/common-core';
import type { MaterializedBufferState } from '../models/materializedBufferState.js';
import type { WritingCategory } from '../models/writingCategory.js';
import type { Logger } from '@intexuraos/common-core';

export interface DraftGenerator {
  generate(
    state: MaterializedBufferState,
    priorDraft: string | null,
    requestText: string,
    styleInstructions: string | null,
    writingSamples: string[],
    category: WritingCategory,
    logger: Logger
  ): Promise<Result<string>>;
}
