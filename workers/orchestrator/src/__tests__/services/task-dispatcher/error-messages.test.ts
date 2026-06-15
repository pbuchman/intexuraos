import { describe, it, expect } from 'vitest';
import { buildRuntimeHardErrorMessage } from '../../../services/task-dispatcher/error-messages.js';

describe('buildRuntimeHardErrorMessage', () => {
  it('includes exit code when non-zero', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: 1,
      claudeError: undefined,
      runtimeName: 'Claude',
    });
    expect(message).toBe('Non-zero exit code: 1');
  });

  it('includes runtime error when claudeError is a non-empty string', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: undefined,
      claudeError: 'Task failed: rate limited',
      runtimeName: 'Claude',
    });
    expect(message).toBe('Claude error: Task failed: rate limited');
  });

  it('joins exit code and runtime error with a semicolon', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: 1,
      claudeError: 'Task failed: rate limited',
      runtimeName: 'Claude',
    });
    expect(message).toBe('Non-zero exit code: 1; Claude error: Task failed: rate limited');
  });

  it('uses the provided runtime name (not hardcoded Claude)', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: 1,
      claudeError: 'turn failed',
      runtimeName: 'Codex',
    });
    expect(message).toBe('Non-zero exit code: 1; Codex error: turn failed');
  });

  it('omits exit code part when exitCode is zero', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: 0,
      claudeError: 'boom',
      runtimeName: 'Claude',
    });
    expect(message).toBe('Claude error: boom');
  });

  it('omits exit code part when exitCode is undefined', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: undefined,
      claudeError: 'boom',
      runtimeName: 'Claude',
    });
    expect(message).toBe('Claude error: boom');
  });

  it('omits runtime error part when claudeError is undefined', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: 1,
      claudeError: undefined,
      runtimeName: 'Claude',
    });
    expect(message).toBe('Non-zero exit code: 1');
  });

  it('treats empty claudeError like undefined to avoid dangling colon', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: 1,
      claudeError: '',
      runtimeName: 'Claude',
    });
    expect(message).toBe('Non-zero exit code: 1');
  });

  it('returns empty string when no concrete evidence is available', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: undefined,
      claudeError: undefined,
      runtimeName: 'Claude',
    });
    expect(message).toBe('');
  });

  it('returns empty string when exit code is zero and runtime error is empty', () => {
    const message = buildRuntimeHardErrorMessage({
      exitCode: 0,
      claudeError: '',
      runtimeName: 'Claude',
    });
    expect(message).toBe('');
  });
});
