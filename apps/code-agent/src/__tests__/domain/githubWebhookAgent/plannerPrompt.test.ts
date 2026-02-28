import { describe, it, expect } from 'vitest';
import {
  githubWebhookPlannerPrompt,
  serializePlannerInput,
  type PlannerInput,
} from '../../../domain/githubWebhookAgent/plannerPrompt.js';

function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    eventGroup: 'comment',
    action: 'created',
    senderLogin: 'pbuchman',
    body: 'Please fix the login validation bug',
    hasExistingTask: false,
    existingTaskWorkerType: null,
    detectedDirective: null,
    senderAllowed: true,
    userMapped: true,
    ...overrides,
  };
}

describe('githubWebhookPlannerPrompt', () => {
  describe('metadata', () => {
    it('exports name and version', () => {
      expect(githubWebhookPlannerPrompt.name).toBe('github-webhook-planner');
      expect(githubWebhookPlannerPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('exports a description', () => {
      expect(githubWebhookPlannerPrompt.description).toBeTruthy();
    });
  });

  describe('build', () => {
    it('includes hard rule that LLM must not execute actions', () => {
      const prompt = githubWebhookPlannerPrompt.build(makeInput());
      expect(prompt).toContain('do not execute');
    });

    it('includes JSON-only output requirement', () => {
      const prompt = githubWebhookPlannerPrompt.build(makeInput());
      expect(prompt).toContain('JSON');
    });

    it('includes few-shot examples', () => {
      const prompt = githubWebhookPlannerPrompt.build(makeInput());
      expect(prompt).toContain('noop');
      expect(prompt).toContain('actionable');
    });

    it('includes no-worker-switch policy for existing tasks', () => {
      const prompt = githubWebhookPlannerPrompt.build(
        makeInput({ hasExistingTask: true, existingTaskWorkerType: 'opus' })
      );
      expect(prompt).toContain('worker');
    });

    it('truncates long body in prompt', () => {
      const longBody = 'x'.repeat(10000);
      const prompt = githubWebhookPlannerPrompt.build(makeInput({ body: longBody }));
      expect(prompt.length).toBeLessThan(longBody.length);
    });
  });
});

describe('serializePlannerInput', () => {
  it('serializes basic input fields', () => {
    const serialized = serializePlannerInput(makeInput());
    expect(serialized).toContain('comment');
    expect(serialized).toContain('created');
    expect(serialized).toContain('pbuchman');
  });

  it('includes detected directive when present', () => {
    const serialized = serializePlannerInput(
      makeInput({
        detectedDirective: {
          found: true,
          workerType: 'opus',
          source: 'explicit_comment',
          matches: ['/intex worker=opus'],
        },
      })
    );
    expect(serialized).toContain('detectedDirective');
    expect(serialized).toContain('opus');
  });

  it('includes null directive when not found', () => {
    const serialized = serializePlannerInput(makeInput({ detectedDirective: null }));
    expect(serialized).toContain('"detectedDirective":null');
  });

  it('includes existing task worker type', () => {
    const serialized = serializePlannerInput(
      makeInput({ hasExistingTask: true, existingTaskWorkerType: 'sonnet' })
    );
    expect(serialized).toContain('existingTaskWorkerType');
    expect(serialized).toContain('sonnet');
  });

  it('handles null body', () => {
    const serialized = serializePlannerInput(makeInput({ body: null }));
    expect(serialized).toContain('"body":null');
  });

  it('truncates long body to max length', () => {
    const longBody = 'a'.repeat(10000);
    const serialized = serializePlannerInput(makeInput({ body: longBody }));
    expect(serialized.length).toBeLessThan(longBody.length);
  });

  it('produces valid JSON', () => {
    const serialized = serializePlannerInput(makeInput());
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it('is deterministic for identical inputs', () => {
    const input = makeInput();
    const a = serializePlannerInput(input);
    const b = serializePlannerInput(input);
    expect(a).toBe(b);
  });
});
