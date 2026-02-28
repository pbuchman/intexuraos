import { describe, it, expect } from 'vitest';
import {
  validateAndNormalizePlannerResponse,
  type PlannerContext,
  type PlannerResult,
} from '../../../domain/githubWebhookAgent/planner.js';

function makeContext(overrides: Partial<PlannerContext> = {}): PlannerContext {
  return {
    eventGroup: 'comment',
    hasExistingTask: false,
    existingTaskWorkerType: null,
    confidenceThreshold: 0.6,
    ...overrides,
  };
}

const VALID_RESPONSE = JSON.stringify({
  version: '1.0',
  eventGroup: 'comment',
  actionability: 'actionable',
  confidence: 0.9,
  reasoning: 'Human comment requesting code change',
  requestedWorkerType: null,
  decision: { kind: 'send_task_message' },
});

describe('validateAndNormalizePlannerResponse', () => {
  describe('stage 1: JSON parsing', () => {
    it('returns noop for non-JSON text', () => {
      const result = validateAndNormalizePlannerResponse(
        'I cannot determine the action to take.',
        makeContext()
      );
      expectNoopWithError(result, 'json_parse_error');
    });

    it('returns noop for JSON array instead of object', () => {
      const result = validateAndNormalizePlannerResponse(
        '[{"actionability": "actionable"}]',
        makeContext()
      );
      expectNoopWithError(result, 'json_parse_error');
    });

    it('returns noop for empty string', () => {
      const result = validateAndNormalizePlannerResponse('', makeContext());
      expectNoopWithError(result, 'json_parse_error');
    });

    it('extracts JSON from markdown code block', () => {
      const wrapped = '```json\n' + VALID_RESPONSE + '\n```';
      const result = validateAndNormalizePlannerResponse(wrapped, makeContext());
      expect(result.decision.actionability).toBe('actionable');
      expect(result.validationErrors).toHaveLength(0);
    });
  });

  describe('stage 2: schema validation', () => {
    it('returns noop for unknown decision kind', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'actionable',
        confidence: 0.9,
        reasoning: 'Test',
        requestedWorkerType: null,
        decision: { kind: 'launch_missiles' },
      });
      const result = validateAndNormalizePlannerResponse(response, makeContext());
      expectNoopWithError(result, 'schema_validation_error');
    });

    it('returns noop for missing required fields', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
      });
      const result = validateAndNormalizePlannerResponse(response, makeContext());
      expectNoopWithError(result, 'schema_validation_error');
    });

    it('returns noop for unsupported requestedWorkerType', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'actionable',
        confidence: 0.9,
        reasoning: 'Test',
        requestedWorkerType: 'gpt4',
        decision: { kind: 'send_task_message' },
      });
      const result = validateAndNormalizePlannerResponse(response, makeContext());
      expectNoopWithError(result, 'schema_validation_error');
    });

    it('returns noop for string confidence', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'actionable',
        confidence: 'high',
        reasoning: 'Test',
        requestedWorkerType: null,
        decision: { kind: 'send_task_message' },
      });
      const result = validateAndNormalizePlannerResponse(response, makeContext());
      expectNoopWithError(result, 'schema_validation_error');
    });
  });

  describe('stage 3: policy validation', () => {
    it('returns noop when existing task has worker switch', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'actionable',
        confidence: 0.9,
        reasoning: 'Worker switch requested',
        requestedWorkerType: 'opus',
        decision: { kind: 'create_pr_comment_task' },
      });
      const result = validateAndNormalizePlannerResponse(
        response,
        makeContext({
          hasExistingTask: true,
          existingTaskWorkerType: 'sonnet',
        })
      );
      expectNoopWithError(result, 'policy_violation');
    });

    it('allows same worker type on existing task', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'actionable',
        confidence: 0.9,
        reasoning: 'Same worker',
        requestedWorkerType: 'sonnet',
        decision: { kind: 'send_task_message' },
      });
      const result = validateAndNormalizePlannerResponse(
        response,
        makeContext({
          hasExistingTask: true,
          existingTaskWorkerType: 'sonnet',
        })
      );
      expect(result.decision.actionability).toBe('actionable');
      expect(result.validationErrors).toHaveLength(0);
    });

    it('allows null worker type on existing task', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'actionable',
        confidence: 0.9,
        reasoning: 'No worker change',
        requestedWorkerType: null,
        decision: { kind: 'send_task_message' },
      });
      const result = validateAndNormalizePlannerResponse(
        response,
        makeContext({
          hasExistingTask: true,
          existingTaskWorkerType: 'opus',
        })
      );
      expect(result.decision.actionability).toBe('actionable');
    });
  });

  describe('confidence threshold', () => {
    it('downgrades low confidence to noop', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'actionable',
        confidence: 0.3,
        reasoning: 'Not sure',
        requestedWorkerType: null,
        decision: { kind: 'send_task_message' },
      });
      const result = validateAndNormalizePlannerResponse(
        response,
        makeContext({ confidenceThreshold: 0.6 })
      );
      expectNoopWithError(result, 'low_confidence');
    });

    it('allows confidence exactly at threshold', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'actionable',
        confidence: 0.6,
        reasoning: 'Just enough confidence',
        requestedWorkerType: null,
        decision: { kind: 'send_task_message' },
      });
      const result = validateAndNormalizePlannerResponse(
        response,
        makeContext({ confidenceThreshold: 0.6 })
      );
      expect(result.decision.actionability).toBe('actionable');
      expect(result.validationErrors).toHaveLength(0);
    });

    it('skips confidence check for non_actionable decisions', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'non_actionable',
        confidence: 0.3,
        reasoning: 'Bot noise',
        requestedWorkerType: null,
        decision: { kind: 'noop' },
      });
      const result = validateAndNormalizePlannerResponse(
        response,
        makeContext({ confidenceThreshold: 0.6 })
      );
      expect(result.decision.actionability).toBe('non_actionable');
      expect(result.validationErrors).toHaveLength(0);
    });
  });

  describe('valid responses', () => {
    it('passes valid actionable response through', () => {
      const result = validateAndNormalizePlannerResponse(VALID_RESPONSE, makeContext());
      expect(result.decision.actionability).toBe('actionable');
      expect(result.decision.decision.kind).toBe('send_task_message');
      expect(result.validationErrors).toHaveLength(0);
      expect(result.rawText).toBe(VALID_RESPONSE);
    });

    it('passes valid noop response through', () => {
      const response = JSON.stringify({
        version: '1.0',
        eventGroup: 'comment',
        actionability: 'non_actionable',
        confidence: 1.0,
        reasoning: 'Coverage report',
        requestedWorkerType: null,
        decision: { kind: 'noop' },
      });
      const result = validateAndNormalizePlannerResponse(response, makeContext());
      expect(result.decision.actionability).toBe('non_actionable');
      expect(result.decision.decision.kind).toBe('noop');
    });
  });

  describe('determinism', () => {
    it('returns identical results for identical inputs', () => {
      const a = validateAndNormalizePlannerResponse(VALID_RESPONSE, makeContext());
      const b = validateAndNormalizePlannerResponse(VALID_RESPONSE, makeContext());
      expect(a).toEqual(b);
    });
  });
});

function expectNoopWithError(result: PlannerResult, errorCode: string): void {
  expect(result.decision.actionability).toBe('non_actionable');
  expect(result.decision.decision.kind).toBe('noop');
  expect(result.validationErrors.length).toBeGreaterThan(0);
  expect(result.validationErrors.some((e) => e.code === errorCode)).toBe(true);
}
