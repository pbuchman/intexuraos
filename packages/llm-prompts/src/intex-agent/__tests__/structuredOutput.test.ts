import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Intex Agent strict structured output', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('zod-to-json-schema');
  });

  it('derives provider-compatible strict root object schemas from the domain schemas', async () => {
    const { INTEX_AGENT_INTENT_CLASSIFIER_RESPONSE_FORMAT, INTEX_AGENT_RUNNER_RESPONSE_FORMAT } =
      await import('../structuredOutput.js');

    expect(INTEX_AGENT_INTENT_CLASSIFIER_RESPONSE_FORMAT).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'intex_agent_intent_classifier',
        strict: true,
        schema: {
          type: 'object',
          properties: expect.any(Object),
          required: expect.any(Array),
          additionalProperties: false,
        },
      },
    });
    expect(INTEX_AGENT_RUNNER_RESPONSE_FORMAT).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'intex_agent_runner_output',
        strict: true,
        schema: {
          type: 'object',
          properties: expect.any(Object),
          required: expect.any(Array),
          additionalProperties: false,
        },
      },
    });

    for (const responseFormat of [
      INTEX_AGENT_INTENT_CLASSIFIER_RESPONSE_FORMAT,
      INTEX_AGENT_RUNNER_RESPONSE_FORMAT,
    ]) {
      const schema = responseFormat.json_schema.schema;
      const properties = schema['properties'] as Record<string, unknown>;
      const required = schema['required'] as string[];
      expect(schema).not.toHaveProperty('anyOf');
      expect([...required].sort()).toEqual(Object.keys(properties).sort());
    }

    expect(INTEX_AGENT_INTENT_CLASSIFIER_RESPONSE_FORMAT.json_schema.schema).toMatchObject({
      properties: {
        question: {
          anyOf: expect.arrayContaining([{ type: 'null' }]),
        },
      },
    });
  });

  it('removes provider nulls only from object fields before domain validation', async () => {
    const { IntexAgentIntentClassifierProviderOutputSchema, IntexAgentRunnerProviderOutputSchema } =
      await import('../structuredOutput.js');

    const classifier = IntexAgentIntentClassifierProviderOutputSchema.safeParse({
      outcome: 'tool',
      confidence: 0.95,
      allowedToolNames: ['create_calendar_event'],
      question: null,
      clarification: null,
      reason: 'Explicit calendar creation request.',
      blockerReason: null,
      missingFields: null,
      candidateIntents: null,
      suggestedNextStep: null,
      stylePreferenceAction: 'none',
      languageOverride: null,
      decisionEvidence: 'Create a calendar event.',
    });
    expect(classifier.success).toBe(true);
    if (classifier.success) {
      expect(classifier.data).not.toHaveProperty('question');
      expect(classifier.data).not.toHaveProperty('blockerReason');
    }

    const runner = IntexAgentRunnerProviderOutputSchema.safeParse({
      outcome: 'needs_clarification',
      reply: 'Which date?',
      summary: null,
      blockerReason: 'missing_required_details',
      missingFields: ['date'],
      suggestedNextStep: null,
      clarification: null,
      candidateIntents: ['create_calendar_event'],
      errorCategory: null,
      isRetryable: null,
      attemptedAction: null,
    });
    expect(runner.success).toBe(true);
    if (runner.success) {
      expect(runner.data).not.toHaveProperty('summary');
      expect(runner.data).not.toHaveProperty('suggestedNextStep');
    }
  });

  it.each([null, [], 'not an object'])(
    'keeps non-object provider output invalid: %j',
    async (providerOutput) => {
      const { IntexAgentRunnerProviderOutputSchema } = await import('../structuredOutput.js');

      expect(IntexAgentRunnerProviderOutputSchema.safeParse(providerOutput).success).toBe(false);
    }
  );

  it('does not turn a required provider null into a valid optional field', async () => {
    const { IntexAgentIntentClassifierProviderOutputSchema } =
      await import('../structuredOutput.js');

    expect(
      IntexAgentIntentClassifierProviderOutputSchema.safeParse({
        outcome: 'tool',
        confidence: 0.95,
        allowedToolNames: ['create_calendar_event'],
        stylePreferenceAction: null,
      }).success
    ).toBe(false);
  });

  it('does not hide unknown null fields from strict domain validation', async () => {
    const { IntexAgentRunnerProviderOutputSchema } = await import('../structuredOutput.js');

    expect(
      IntexAgentRunnerProviderOutputSchema.safeParse({
        outcome: 'no_action',
        reply: 'OK',
        unknown: null,
      }).success
    ).toBe(false);
  });

  it.each([{ outcome: 1 }, { outcome: 'unknown' }])(
    'keeps an invalid provider outcome fail-closed: %j',
    async (providerOutput) => {
      const { IntexAgentRunnerProviderOutputSchema } = await import('../structuredOutput.js');

      expect(IntexAgentRunnerProviderOutputSchema.safeParse(providerOutput).success).toBe(false);
    }
  );

  it('projects only explicitly safe non-null strict-superset fields', async () => {
    const { IntexAgentIntentClassifierProviderOutputSchema, IntexAgentRunnerProviderOutputSchema } =
      await import('../structuredOutput.js');

    const classifier = IntexAgentIntentClassifierProviderOutputSchema.safeParse({
      outcome: 'needs_clarification',
      confidence: 0.95,
      question: 'Should this repeat?',
      blockerReason: 'missing_required_details',
      missingFields: ['recurrence'],
      candidateIntents: ['create_calendar_event'],
      stylePreferenceAction: 'none',
      allowedToolNames: ['create_calendar_event'],
    });
    expect(classifier.success).toBe(true);
    if (classifier.success) {
      expect(classifier.data).not.toHaveProperty('allowedToolNames');
    }

    const runnerNullPlaceholders = IntexAgentRunnerProviderOutputSchema.safeParse({
      outcome: 'no_action',
      reply: 'OK',
      toolName: null,
      blockerReason: null,
      missingFields: null,
      suggestedNextStep: null,
    });
    expect(runnerNullPlaceholders.success).toBe(true);
    if (runnerNullPlaceholders.success) {
      expect(runnerNullPlaceholders.data).not.toHaveProperty('toolName');
      expect(runnerNullPlaceholders.data).not.toHaveProperty('blockerReason');
    }

    expect(
      IntexAgentRunnerProviderOutputSchema.safeParse({
        outcome: 'no_action',
        reply: 'Saved the note.',
        toolName: 'create_note',
      }).success
    ).toBe(false);
  });

  it('fails module initialization when JSON Schema conversion omits a definition', async () => {
    vi.doMock('zod-to-json-schema', () => ({
      zodToJsonSchema: vi.fn(() => ({})),
    }));

    await expect(import('../structuredOutput.js')).rejects.toThrow(
      'Failed to derive strict JSON schema definition for intex_agent_intent_classifier'
    );
  });

  it.each([{ anyOf: undefined }, { anyOf: [] }])(
    'rejects a converted domain schema without a non-empty root union: %j',
    async (definition) => {
      mockConvertedDefinition(definition);

      await expect(import('../structuredOutput.js')).rejects.toThrow(
        'Strict JSON schema intex_agent_intent_classifier must provide a non-empty root anyOf'
      );
    }
  );

  it.each([null, { type: 'array' }, { type: 'object', properties: null, required: [] }])(
    'rejects a non-object root union branch: %j',
    async (branch) => {
      mockConvertedDefinition({ anyOf: [branch] });

      await expect(import('../structuredOutput.js')).rejects.toThrow(
        'Strict JSON schema intex_agent_intent_classifier branch 0 must be an object'
      );
    }
  );

  it.each([
    { type: 'object', properties: { value: { type: 'string' } } },
    { type: 'object', properties: { value: { type: 'string' } }, required: [1] },
  ])('rejects a root union branch without string required fields: %j', async (branch) => {
    mockConvertedDefinition({ anyOf: [branch] });

    await expect(import('../structuredOutput.js')).rejects.toThrow(
      'Strict JSON schema intex_agent_intent_classifier branch 0 must declare required'
    );
  });

  it.each([
    {
      type: 'object',
      properties: { outcome: { const: 'tool' } },
      required: [],
    },
    {
      type: 'object',
      properties: { outcome: {} },
      required: ['outcome'],
    },
    {
      type: 'object',
      properties: { outcome: { enum: [] } },
      required: ['outcome'],
    },
    {
      type: 'object',
      properties: { outcome: { enum: [1] } },
      required: ['outcome'],
    },
  ])('rejects a root union branch without a string outcome discriminator: %j', async (branch) => {
    mockConvertedDefinition({ anyOf: [branch] });

    await expect(import('../structuredOutput.js')).rejects.toThrow(
      'Strict JSON schema intex_agent_intent_classifier branch 0 must declare an outcome discriminator'
    );
  });
});

function mockConvertedDefinition(definition: Record<string, unknown>): void {
  vi.doMock('zod-to-json-schema', () => ({
    zodToJsonSchema: vi.fn((_schema: unknown, options: { name: string }) => ({
      definitions: { [options.name]: definition },
    })),
  }));
}
