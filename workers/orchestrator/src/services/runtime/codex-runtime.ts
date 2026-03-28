import type { RuntimeAdapter } from './types.js';
import { codexLogProcessor, type CodexAttemptState } from './processors/codex-log-processor.js';

export const codexRuntime: RuntimeAdapter<CodexAttemptState> = {
  runtime: 'codex',
  createAttemptState(taskId, logger) {
    return {
      taskId,
      logger,
      logBuffer: '',
      completionSignaled: false,
    };
  },
  processLogChunk(state, chunk) {
    return codexLogProcessor.processChunk(state, chunk);
  },
  flushAttemptState(state) {
    return codexLogProcessor.flushState(state);
  },
};
