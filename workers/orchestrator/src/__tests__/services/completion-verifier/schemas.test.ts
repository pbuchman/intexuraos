import { describe, expect, it } from 'vitest';
import {
  RESUME_SUMMARY_SCHEMA,
  type CompletionAgentType,
} from '../../../services/completion-verifier/schemas.js';

describe('CompletionAgentType (post-INT-1470)', () => {
  it('type-checks every known agent variant', () => {
    const agents: CompletionAgentType[] = [
      'planning',
      'execution',
      'pull_request',
      'review',
      'remediation',
      'ask_agent',
      'sentry',
    ];
    expect(agents.length).toBe(7);
  });
});

describe('RESUME_SUMMARY_SCHEMA', () => {
  it('accepts a plain {summary: string} object', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({ summary: 'did stuff' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing summary field', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a non-string summary', () => {
    const result = RESUME_SUMMARY_SCHEMA.safeParse({ summary: 42 });
    expect(result.success).toBe(false);
  });
});
