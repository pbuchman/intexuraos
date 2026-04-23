import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatLocalTime,
  appendTaggedTaskLog,
  appendOrchestratorTaskLog,
  flushTaskLogs,
  flushAndCloseLogForwarder,
} from '../../../services/task-dispatcher/log-streaming.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
};

function createMockLogForwarder(): {
  appendChunk: ReturnType<typeof vi.fn>;
  appendRawChunk: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  flushAndStop: ReturnType<typeof vi.fn>;
  registerTask: ReturnType<typeof vi.fn>;
  unregisterTask: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  getDroppedChunkCount: ReturnType<typeof vi.fn>;
} {
  return {
    appendChunk: vi.fn(),
    appendRawChunk: vi.fn(),
    flush: vi.fn(),
    flushAndStop: vi.fn(),
    registerTask: vi.fn(),
    unregisterTask: vi.fn(),
    close: vi.fn(),
    getDroppedChunkCount: vi.fn().mockReturnValue(0),
  };
}

describe('formatLocalTime', () => {
  it('formats a morning time with leading zeros', () => {
    const date = new Date(2024, 0, 1, 7, 5, 3, 42);
    expect(formatLocalTime(date)).toBe('07:05:03.042');
  });

  it('formats an afternoon time in 24-hour format', () => {
    const date = new Date(2024, 0, 1, 23, 59, 59, 999);
    expect(formatLocalTime(date)).toBe('23:59:59.999');
  });

  it('pads milliseconds to exactly 3 digits', () => {
    const date = new Date(2024, 0, 1, 0, 0, 0, 7);
    expect(formatLocalTime(date)).toBe('00:00:00.007');
  });
});

describe('appendTaggedTaskLog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 1, 12, 34, 56, 789));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prefixes the message with the local time and the given tag', () => {
    const lf = createMockLogForwarder();
    appendTaggedTaskLog(lf as never, 'task-1', 'prompt', 'Hello world');
    expect(lf.appendChunk).toHaveBeenCalledWith('task-1', '12:34:56.789 [prompt] Hello world\n');
  });

  it('supports multi-line messages verbatim', () => {
    const lf = createMockLogForwarder();
    appendTaggedTaskLog(lf as never, 'task-2', 'system', 'line1\nline2');
    expect(lf.appendChunk).toHaveBeenCalledWith('task-2', '12:34:56.789 [system] line1\nline2\n');
  });
});

describe('appendOrchestratorTaskLog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 1, 5, 5, 5, 5));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tags the line as `orchestrator`', () => {
    const lf = createMockLogForwarder();
    appendOrchestratorTaskLog(lf as never, 'task-3', 'status');
    expect(lf.appendChunk).toHaveBeenCalledWith('task-3', '05:05:05.005 [orchestrator] status\n');
  });
});

describe('flushTaskLogs', () => {
  beforeEach(() => {
    mockLogger.warn.mockReset();
  });

  it('calls logForwarder.flush with the task id', async () => {
    const lf = createMockLogForwarder();
    lf.flush.mockResolvedValueOnce(undefined);
    await flushTaskLogs(lf as never, mockLogger as never, 'task-1');
    expect(lf.flush).toHaveBeenCalledWith('task-1');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('swallows the error and logs a warning when flush rejects', async () => {
    const lf = createMockLogForwarder();
    const err = new Error('boom');
    lf.flush.mockRejectedValueOnce(err);
    await flushTaskLogs(lf as never, mockLogger as never, 'task-2');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { taskId: 'task-2', error: err },
      'Failed to flush task logs'
    );
  });
});

describe('flushAndCloseLogForwarder', () => {
  beforeEach(() => {
    mockLogger.warn.mockReset();
  });

  it('flushes then closes the log forwarder', async () => {
    const lf = createMockLogForwarder();
    lf.flush.mockResolvedValueOnce(undefined);
    await flushAndCloseLogForwarder(lf as never, mockLogger as never, 'task-1');
    expect(lf.flush).toHaveBeenCalledWith('task-1');
    expect(lf.close).toHaveBeenCalledWith('task-1');
  });

  it('swallows close errors and warns', async () => {
    const lf = createMockLogForwarder();
    lf.flush.mockResolvedValueOnce(undefined);
    const closeErr = new Error('close failed');
    lf.close.mockImplementationOnce(() => {
      throw closeErr;
    });
    await flushAndCloseLogForwarder(lf as never, mockLogger as never, 'task-2');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { taskId: 'task-2', error: closeErr },
      'Failed to close log forwarder after compliance validation'
    );
  });
});
