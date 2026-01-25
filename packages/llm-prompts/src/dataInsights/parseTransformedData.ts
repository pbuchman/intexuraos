/**
 * Parser for data transformation LLM responses.
 */

import { formatZodErrors } from '@intexuraos/llm-utils';
import { TransformedDataSchema } from './contextSchemas.js';

/**
 * Parse transformed data response from LLM.
 * Expected format:
 *   DATA_START
 *   [...array...]
 *   DATA_END
 */
export function parseTransformedData(response: string): unknown[] {
  const dataMatch = /DATA_START\s*([\s\S]*?)\s*DATA_END/.exec(response);

  if (dataMatch?.[1] === undefined) {
    throw new Error('Missing DATA_START...DATA_END markers');
  }

  const dataJson = dataMatch[1].trim();

  if (dataJson.length === 0) {
    throw new Error('Data is empty');
  }

  let data: unknown;
  try {
    data = JSON.parse(dataJson);
  } catch (error) {
    throw new Error(`Invalid JSON in data: ${String(error)}`);
  }

  const validationResult = TransformedDataSchema.safeParse(data);
  if (!validationResult.success) {
    const zodErrors = formatZodErrors(validationResult.error);
    throw new Error(`Invalid data array: ${zodErrors}`);
  }

  return validationResult.data;
}
