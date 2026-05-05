import type { FastifyInstance } from 'fastify';
import { LlmProviders } from '@intexuraos/llm-contract';

const PROVIDER_VALUES = Object.values(LlmProviders);

/**
 * Usage event input JSON Schema. Mirrors the UsageEventInput TypeScript
 * type in apps/llm-usage-service/src/domain/models/usageEvent.ts exactly.
 * The cost object only has providerReportedUsd and pricingSource;
 * billedUsd and calculatedUsd are computed server-side.
 *
 * Used as the body.items schema for POST /internal/usage/events. The webhook
 * endpoint references the stricter OrchestratorUsageEventInput below.
 *
 * `additionalProperties: false` is set at every object level so unknown fields
 * are rejected with a 400, not silently accepted.
 */
export const usageEventInputSchema = {
  $id: 'UsageEventInput',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'eventId',
    'occurredAt',
    'owner',
    'source',
    'request',
    'usage',
    'cost',
    'correlation',
    'error',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [2] },
    eventId: { type: 'string', minLength: 1 },
    occurredAt: { type: 'string', format: 'date-time' },
    owner: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', enum: ['user', 'system'] },
        id: { type: 'string', minLength: 1 },
      },
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['service', 'component', 'client', 'environment'],
      properties: {
        service: { type: 'string', minLength: 1 },
        component: { type: 'string', minLength: 1 },
        client: { type: 'string', minLength: 1 },
        environment: {
          type: 'string',
          enum: ['dev', 'prod', 'test'],
          description:
            'The intexuraos environment of the caller that originated this usage. For events emitted by the orchestrator, this is the environment of the code-agent that dispatched the task, NOT the orchestrator\'s own environment (the orchestrator has no environment, only a location).',
        },
        workerLocation: {
          type: 'string',
          minLength: 1,
          description:
            "Physical location identifier of the orchestrator that produced this event (e.g. 'home-dev', 'mac-dev', 'office-pc'). Required at the webhook endpoint (via OrchestratorUsageEventInput); optional on the internal endpoint.",
        },
      },
    },
    request: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'model', 'operation', 'success', 'durationMs'],
      properties: {
        provider: { type: 'string', enum: PROVIDER_VALUES },
        model: { type: 'string', minLength: 1 },
        operation: {
          type: 'string',
          enum: [
            'research',
            'generate',
            'image_generation',
            'tool_calling',
            'other',
          ],
        },
        success: { type: 'boolean' },
        durationMs: { type: 'number', minimum: 0 },
        promptType: { type: 'string' },
      },
    },
    usage: {
      type: 'object',
      additionalProperties: false,
      required: [
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'cacheReadTokens',
        'cacheWriteTokens',
        'cachedTokens',
        'reasoningTokens',
        'thinkingTokens',
        'webSearchCalls',
        'groundingEnabled',
        'imageCount',
      ],
      properties: {
        inputTokens: { type: 'number', minimum: 0 },
        outputTokens: { type: 'number', minimum: 0 },
        totalTokens: { type: 'number', minimum: 0 },
        cacheReadTokens: { type: 'number', minimum: 0 },
        cacheWriteTokens: { type: 'number', minimum: 0 },
        cachedTokens: { type: 'number', minimum: 0 },
        reasoningTokens: { type: 'number', minimum: 0 },
        thinkingTokens: { type: 'number', minimum: 0 },
        webSearchCalls: { type: 'number', minimum: 0 },
        groundingEnabled: { type: 'boolean' },
        imageCount: { type: 'number', minimum: 0 },
        imageSize: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] },
      },
    },
    cost: {
      type: 'object',
      additionalProperties: false,
      required: ['providerReportedUsd', 'pricingSource'],
      properties: {
        providerReportedUsd: { type: ['number', 'null'] },
        pricingSource: {
          type: 'string',
          enum: ['provider_reported', 'pending'],
        },
      },
    },
    correlation: {
      type: 'object',
      additionalProperties: false,
      required: ['requestId', 'traceId', 'taskId', 'researchId', 'attempt', 'sessionId'],
      properties: {
        requestId: { type: ['string', 'null'] },
        traceId: { type: ['string', 'null'] },
        taskId: { type: ['string', 'null'] },
        researchId: { type: ['string', 'null'] },
        attempt: { type: ['number', 'null'] },
        sessionId: { type: ['string', 'null'] },
      },
    },
    error: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message'],
          properties: {
            code: { type: ['string', 'null'] },
            message: { type: ['string', 'null'] },
          },
        },
      ],
    },
  },
} as const;

/**
 * Orchestrator-specific usage event input schema. Extends the base via `allOf`:
 *
 *   1. Pins `source.service` to the literal `'orchestrator'` (was previously
 *      enforced by an imperative for-loop in webhookUsageRoutes.ts).
 *   2. Makes `source.workerLocation` a required field (was previously not
 *      validated anywhere).
 *
 * Used as the body.items schema for POST /internal/webhooks/usage-events.
 */
export const orchestratorUsageEventInputSchema = {
  $id: 'OrchestratorUsageEventInput',
  allOf: [
    { $ref: 'UsageEventInput#' },
    {
      type: 'object',
      required: ['source'],
      properties: {
        source: {
          type: 'object',
          required: ['service', 'workerLocation'],
          properties: {
            service: { const: 'orchestrator' },
          },
        },
      },
    },
  ],
} as const;

/**
 * Registers all usage event schemas with the Fastify app's Ajv instance.
 *
 * Must be called AFTER `registerCoreSchemas(app)` and BEFORE any route is
 * registered that references these schemas via `$ref`. Order within this
 * function matters: the base schemas must be added before the orchestrator
 * schemas resolve their `$ref`.
 */
export function registerUsageSchemas(app: FastifyInstance): void {
  app.addSchema(usageEventInputSchema);
  app.addSchema(orchestratorUsageEventInputSchema);
}
