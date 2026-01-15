import { describe, expect, it } from 'vitest';
import { parseTransformedData } from '../parseTransformedData.js';

describe('parseTransformedData', () => {
  const validResponse = `
    DATA_START
    [
      {"name": "Alice", "age": 30},
      {"name": "Bob", "age": 25}
    ]
    DATA_END
  `;

  it('parses valid transformed data successfully', () => {
    const result = parseTransformedData(validResponse);

    expect(result).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
  });

  it('throws when DATA_START markers are missing', () => {
    const response = 'No markers here';

    expect(() => parseTransformedData(response)).toThrow('Missing DATA_START...DATA_END markers');
  });

  it('throws when data is empty', () => {
    const response = `
      DATA_START

      DATA_END
    `;

    expect(() => parseTransformedData(response)).toThrow('Data is empty');
  });

  it('throws when JSON is invalid', () => {
    const response = `
      DATA_START
      [{"invalid": json}]
      DATA_END
    `;

    expect(() => parseTransformedData(response)).toThrow('Invalid JSON in data');
  });

  it('throws when data is not an array', () => {
    const response = `
      DATA_START
      {"not": "an array"}
      DATA_END
    `;

    expect(() => parseTransformedData(response)).toThrow('Data must be an array');
  });

  it('throws when array is empty', () => {
    const response = `
      DATA_START
      []
      DATA_END
    `;

    expect(() => parseTransformedData(response)).toThrow('Data array cannot be empty');
  });

  it('throws when array item is not an object', () => {
    const response = `
      DATA_START
      [{"valid": "object"}, "string", {"another": "object"}]
      DATA_END
    `;

    expect(() => parseTransformedData(response)).toThrow('Item at index 1 must be an object');
  });

  it('throws when array item is null', () => {
    const response = `
      DATA_START
      [null]
      DATA_END
    `;

    expect(() => parseTransformedData(response)).toThrow('Item at index 0 must be an object');
  });

  it('throws when array item is an array', () => {
    const response = `
      DATA_START
      [["nested", "array"]]
      DATA_END
    `;

    expect(() => parseTransformedData(response)).toThrow('Item at index 0 must be an object');
  });

  it('handles array with nested objects', () => {
    const response = `
      DATA_START
      [{"user": {"name": "Alice", "meta": {"id": 1}}}]
      DATA_END
    `;

    const result = parseTransformedData(response);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ user: { name: 'Alice', meta: { id: 1 } } });
  });

  it('handles extra whitespace', () => {
    const response = `
    DATA_START

    [
      {"name": "Alice"}
    ]

    DATA_END
    `;

    const result = parseTransformedData(response);

    expect(result).toEqual([{ name: 'Alice' }]);
  });
});
