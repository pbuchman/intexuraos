import {
  testRunDtoV1Schema,
  testRunListDtoV1Schema,
  testScenarioDtoV1Schema,
} from '@intexuraos/http-contracts';
import type { TestRunDtoV1, TestRunListDtoV1, TestScenarioDtoV1 } from '@/types';

function decode<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new Error('Invalid Test Runs response');
  }
}

export function decodeTestRunListDtoV1(value: unknown): TestRunListDtoV1 {
  return decode(testRunListDtoV1Schema, value);
}

export function decodeTestRunDtoV1(value: unknown): TestRunDtoV1 {
  return decode(testRunDtoV1Schema, value);
}

export function decodeTestScenarioDtoV1(value: unknown): TestScenarioDtoV1 {
  return decode(testScenarioDtoV1Schema, value);
}
