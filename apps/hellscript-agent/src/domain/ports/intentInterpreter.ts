import type { InterpretedIntent } from '../models/hellscriptEvent.js';
import type { MaterializedBufferState } from '../models/materializedBufferState.js';
import type { Logger } from '@intexuraos/common-core';

export interface IntentInterpreter {
  interpret(
    utterance: string,
    currentState: MaterializedBufferState,
    logger: Logger
  ): Promise<InterpretedIntent>;
}
