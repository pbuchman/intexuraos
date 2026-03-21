import type { Result } from '@intexuraos/common-core';
import type { MaterializedBufferState } from '../models/materializedBufferState.js';
import type { Logger } from '@intexuraos/common-core';

export interface DraftGenerator {
  generate(
    state: MaterializedBufferState,
    priorDraft: string | null,
    requestText: string,
    logger: Logger
  ): Promise<Result<string>>;
}
