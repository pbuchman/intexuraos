import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type JsonSchemaObject = Record<string, unknown>;
type ZodSchemaInput = Parameters<typeof zodToJsonSchema>[0];

function extractDefinition(name: string, schema: z.ZodTypeAny): JsonSchemaObject {
  const jsonSchema = zodToJsonSchema(schema as ZodSchemaInput, {
    name,
    $refStrategy: 'none',
  }) as {
    definitions?: Record<string, JsonSchemaObject>;
  };
  const definition = jsonSchema.definitions?.[name];

  if (definition === undefined) {
    throw new Error(`Failed to derive JSON schema definition for ${name}`);
  }

  return definition;
}

export function toOpenApiComponentSchema(name: string, schema: z.ZodTypeAny): JsonSchemaObject {
  return extractDefinition(name, schema);
}

export function toFastifySchema(
  name: string,
  schema: z.ZodTypeAny
): { $id: string } & JsonSchemaObject {
  return {
    $id: name,
    ...extractDefinition(name, schema),
  };
}
