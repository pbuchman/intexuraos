import { describe, expect, it } from 'vitest';
import { buildFailureTriagePrompt, parseTriageResponse, FAILURE_TRIAGE_PROMPT_VERSION } from '../../../domain/prompts/failureTriagePrompt.js';

describe('buildFailureTriagePrompt', () => {
  it('includes error code in prompt', () => {
    const prompt = buildFailureTriagePrompt({
      errorCode: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
      errorMessage: 'Missing required output fields',
      recentLogLines: ['line 1', 'line 2'],
    });

    expect(prompt).toContain('EXECUTION_AGENT_ENFORCEMENT_FAILED');
    expect(prompt).toContain('Missing required output fields');
    expect(prompt).toContain('line 1');
  });

  it('limits log lines to 20', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`);
    const prompt = buildFailureTriagePrompt({
      errorCode: 'TEST_ENFORCEMENT_FAILED',
      errorMessage: 'test',
      recentLogLines: lines,
    });

    // Should only include the LAST 20 lines
    expect(prompt).not.toContain('line 0');
    expect(prompt).toContain('line 10');
    expect(prompt).toContain('line 29');
  });

  it('has a version field', () => {
    expect(FAILURE_TRIAGE_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('parseTriageResponse', () => {
  it('parses valid JSON response with shouldRetry true', () => {
    const result = parseTriageResponse('{"shouldRetry": true, "reason": "Transient formatting error"}');
    expect(result).toEqual({ shouldRetry: true, reason: 'Transient formatting error' });
  });

  it('parses valid JSON response with shouldRetry false', () => {
    const result = parseTriageResponse('{"shouldRetry": false, "reason": "Logic error in output"}');
    expect(result).toEqual({ shouldRetry: false, reason: 'Logic error in output' });
  });

  it('extracts JSON from markdown code block', () => {
    const result = parseTriageResponse('```json\n{"shouldRetry": true, "reason": "test"}\n```');
    expect(result).toEqual({ shouldRetry: true, reason: 'test' });
  });

  it('returns shouldRetry false on parse failure', () => {
    const result = parseTriageResponse('This is not JSON');
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('parse');
  });
});
