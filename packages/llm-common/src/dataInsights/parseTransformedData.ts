/**
 * Parser for data transformation LLM responses.
 */

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

  if (!Array.isArray(data)) {
    throw new Error('Data must be an array');
  }

  if (data.length === 0) {
    throw new Error('Data array cannot be empty');
  }

  for (let i = 0; i < data.length; i++) {
    const item: unknown = data[i];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Item at index ${String(i)} must be an object`);
    }
  }

  return data;
}
