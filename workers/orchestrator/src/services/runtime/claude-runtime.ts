import type { RuntimeAdapter } from './types.js';
import { claudeLogProcessor, type ClaudeAttemptState } from './processors/claude-log-processor.js';

export const claudeRuntime: RuntimeAdapter<ClaudeAttemptState> = {
  runtime: 'claude',
  createAttemptState(taskId, logger) {
    return {
      taskId,
      logger,
      logBuffer: '',
      completionSignaled: false,
    };
  },
  processLogChunk(state, chunk) {
    return claudeLogProcessor.processChunk(state, chunk);
  },
  flushAttemptState(state) {
    return claudeLogProcessor.flushState(state);
  },
};
