import { describe, it, expect } from 'vitest';
import { WORKER_TYPES } from '../../../services/isolation/types.js';

describe('[INT-1461] WORKER_TYPES telemetryExpectation', () => {
  it('every worker type declares telemetryExpectation', () => {
    for (const [name, config] of Object.entries(WORKER_TYPES)) {
      expect(config.telemetryExpectation, `${name} missing telemetryExpectation`).toMatch(
        /^(required|optional)$/
      );
    }
  });

  it('opus, sonnet, and auto are required', () => {
    expect(WORKER_TYPES.opus.telemetryExpectation).toBe('required');
    expect(WORKER_TYPES.sonnet.telemetryExpectation).toBe('required');
    expect(WORKER_TYPES.auto.telemetryExpectation).toBe('required');
  });

  it('provider and Codex workers are optional', () => {
    expect(WORKER_TYPES['openrouter-free'].telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES.codex.telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES['codex-xhigh'].telemetryExpectation).toBe('optional');
  });
});
