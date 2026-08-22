import type { LlmResponseFormat } from '@intexuraos/llm-contract';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { IntexAgentIntentClassifierOutputSchema } from './intentClassifierSchemas.js';
import { IntexAgentCalendarUpdatePlanningOutputSchema } from './calendarUpdatePlanningSchemas.js';
import { IntexAgentRunnerOutputSchema } from './runnerOutputSchemas.js';

type StrictJsonSchemaResponseFormat = Extract<LlmResponseFormat, { type: 'json_schema' }>;
type ZodSchemaInput = Parameters<typeof zodToJsonSchema>[0];
type JsonSchema = Record<string, unknown>;

interface StrictProviderContract {
  responseFormat: StrictJsonSchemaResponseFormat;
  nullableFields: ReadonlySet<string>;
  knownFields: ReadonlySet<string>;
  allowedFieldsByOutcome: ReadonlyMap<string, ReadonlySet<string>>;
  projectableDisallowedFields: ReadonlySet<string>;
}

const intentClassifierProviderContract = strictProviderContract(
  'intex_agent_intent_classifier',
  IntexAgentIntentClassifierOutputSchema,
  ['allowedToolNames']
);
const runnerProviderContract = strictProviderContract(
  'intex_agent_runner_output',
  IntexAgentRunnerOutputSchema
);
const calendarUpdatePlanningProviderContract = strictProviderContract(
  'intex_agent_calendar_update_planning',
  IntexAgentCalendarUpdatePlanningOutputSchema
);

export const IntexAgentIntentClassifierProviderOutputSchema = z.preprocess(
  normalizeStrictProviderOutput(intentClassifierProviderContract),
  IntexAgentIntentClassifierOutputSchema
) as z.ZodType<z.infer<typeof IntexAgentIntentClassifierOutputSchema>>;

export const IntexAgentRunnerProviderOutputSchema = z.preprocess(
  normalizeStrictProviderOutput(runnerProviderContract),
  IntexAgentRunnerOutputSchema
) as z.ZodType<z.infer<typeof IntexAgentRunnerOutputSchema>>;

export const IntexAgentCalendarUpdatePlanningProviderOutputSchema = z.preprocess(
  normalizeStrictProviderOutput(calendarUpdatePlanningProviderContract),
  IntexAgentCalendarUpdatePlanningOutputSchema
) as z.ZodType<z.infer<typeof IntexAgentCalendarUpdatePlanningOutputSchema>>;

export const INTEX_AGENT_INTENT_CLASSIFIER_RESPONSE_FORMAT =
  intentClassifierProviderContract.responseFormat;

export const INTEX_AGENT_RUNNER_RESPONSE_FORMAT = runnerProviderContract.responseFormat;
export const INTEX_AGENT_CALENDAR_UPDATE_PLANNING_RESPONSE_FORMAT =
  calendarUpdatePlanningProviderContract.responseFormat;

function strictProviderContract(
  name: string,
  schema: ZodTypeAny,
  projectableDisallowedFields: readonly string[] = []
): StrictProviderContract {
  const converted = zodToJsonSchema(schema as ZodSchemaInput, {
    name,
    $refStrategy: 'none',
  }) as { definitions?: Record<string, JsonSchema> };
  const definition = converted.definitions?.[name];
  if (definition === undefined) {
    throw new Error(`Failed to derive strict JSON schema definition for ${name}`);
  }

  const {
    schema: strictSchema,
    nullableFields,
    knownFields,
    allowedFieldsByOutcome,
  } = collapseRootUnion(name, definition);
  return {
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name,
        strict: true,
        schema: strictSchema,
      },
    },
    nullableFields,
    knownFields,
    allowedFieldsByOutcome,
    projectableDisallowedFields: new Set(projectableDisallowedFields),
  };
}

function collapseRootUnion(
  name: string,
  definition: JsonSchema
): {
  schema: JsonSchema;
  nullableFields: ReadonlySet<string>;
  knownFields: ReadonlySet<string>;
  allowedFieldsByOutcome: ReadonlyMap<string, ReadonlySet<string>>;
} {
  const rawBranches = definition['anyOf'];
  if (!Array.isArray(rawBranches) || rawBranches.length === 0) {
    throw new Error(`Strict JSON schema ${name} must provide a non-empty root anyOf`);
  }

  const branches = rawBranches.map((rawBranch, index) => readObjectBranch(name, index, rawBranch));
  const propertyNames = [...new Set(branches.flatMap((branch) => Object.keys(branch.properties)))];
  const knownFields = new Set(propertyNames);
  const allowedFieldsByOutcome = new Map<string, ReadonlySet<string>>();
  branches.forEach((branch, index) => {
    const allowedFields = new Set(Object.keys(branch.properties));
    for (const outcome of readOutcomeValues(name, index, branch)) {
      allowedFieldsByOutcome.set(outcome, allowedFields);
    }
  });
  const nullableFields = new Set<string>();
  const properties = Object.fromEntries(
    propertyNames.map((propertyName) => {
      const propertySchemas = branches.flatMap((branch) => {
        const propertySchema = branch.properties[propertyName];
        return propertySchema === undefined ? [] : [propertySchema];
      });
      const requiredInEveryBranch = branches.every(
        (branch) =>
          branch.properties[propertyName] !== undefined && branch.required.has(propertyName)
      );
      const mergedSchema = mergePropertySchemas(propertySchemas);
      if (requiredInEveryBranch) return [propertyName, mergedSchema];
      nullableFields.add(propertyName);
      return [propertyName, { anyOf: [mergedSchema, { type: 'null' }] }];
    })
  );

  return {
    schema: {
      type: 'object',
      properties,
      required: propertyNames,
      additionalProperties: false,
    },
    nullableFields,
    knownFields,
    allowedFieldsByOutcome,
  };
}

function readObjectBranch(
  name: string,
  index: number,
  value: unknown
): { properties: Record<string, JsonSchema>; required: ReadonlySet<string> } {
  if (!isJsonSchema(value) || value['type'] !== 'object' || !isJsonSchema(value['properties'])) {
    throw new Error(`Strict JSON schema ${name} branch ${String(index)} must be an object`);
  }
  const rawRequired = value['required'];
  if (!Array.isArray(rawRequired) || !rawRequired.every((field) => typeof field === 'string')) {
    throw new Error(`Strict JSON schema ${name} branch ${String(index)} must declare required`);
  }

  return {
    properties: value['properties'] as Record<string, JsonSchema>,
    required: new Set(rawRequired),
  };
}

function readOutcomeValues(
  name: string,
  index: number,
  branch: {
    properties: Record<string, JsonSchema>;
    required: ReadonlySet<string>;
  }
): readonly string[] {
  const outcomeSchema = branch.properties['outcome'];
  if (!branch.required.has('outcome') || outcomeSchema === undefined) {
    throw new Error(
      `Strict JSON schema ${name} branch ${String(index)} must declare an outcome discriminator`
    );
  }

  const constant = outcomeSchema['const'];
  if (typeof constant === 'string') return [constant];

  const enumeration = outcomeSchema['enum'];
  if (
    Array.isArray(enumeration) &&
    enumeration.length > 0 &&
    enumeration.every((outcome) => typeof outcome === 'string')
  ) {
    return enumeration;
  }

  throw new Error(
    `Strict JSON schema ${name} branch ${String(index)} must declare an outcome discriminator`
  );
}

function mergePropertySchemas(schemas: readonly JsonSchema[]): JsonSchema {
  const uniqueSchemas = [
    ...new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values(),
  ];
  const firstSchema = uniqueSchemas[0] as JsonSchema;
  return uniqueSchemas.length === 1 ? firstSchema : { anyOf: uniqueSchemas };
}

function normalizeStrictProviderOutput(
  contract: StrictProviderContract
): (value: unknown) => unknown {
  return (value): unknown => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    const outcome = record['outcome'];
    if (typeof outcome !== 'string') return value;
    const allowedFields = contract.allowedFieldsByOutcome.get(outcome);
    if (allowedFields === undefined) return value;

    return Object.fromEntries(
      Object.entries(record).filter(([key, field]) => {
        if (!contract.knownFields.has(key)) return true;
        if (!allowedFields.has(key)) {
          return field !== null && !contract.projectableDisallowedFields.has(key);
        }
        return field !== null || !contract.nullableFields.has(key);
      })
    );
  };
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
