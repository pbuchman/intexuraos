import { describe, expect, it } from 'vitest';

import {
  TEST_RUN_DOCUMENT_MAX_BYTES,
  TEST_RUN_SCENARIO_DOCUMENT_MAX_BYTES,
  checkTestRunDocumentSize,
  checkTestRunScenarioDocumentSize,
  measureJsonUtf8Bytes,
} from '../../../domain/testRuns/sizePolicy.js';
import { testRunRecord } from './testRunFixtures.js';

describe('Test Run document size policy', () => {
  it('rejects values that JSON cannot serialize', () => {
    expect(() => measureJsonUtf8Bytes(undefined)).toThrowError(
      new TypeError('Value is not JSON serializable')
    );
  });

  it('keeps the reviewed byte caps explicit and accepts the complete 20-scenario run fixture', () => {
    expect(TEST_RUN_DOCUMENT_MAX_BYTES).toBe(64 * 1024);
    expect(TEST_RUN_SCENARIO_DOCUMENT_MAX_BYTES).toBe(128 * 1024);
    expect(checkTestRunDocumentSize(testRunRecord())).toMatchObject({ ok: true });
  });

  it('accepts an exact boundary and rejects one additional UTF-8 byte without truncation', () => {
    const prefixBytes = measureJsonUtf8Bytes({ value: '' });
    const exact = { value: 'x'.repeat(TEST_RUN_DOCUMENT_MAX_BYTES - prefixBytes) };
    expect(measureJsonUtf8Bytes(exact)).toBe(TEST_RUN_DOCUMENT_MAX_BYTES);
    expect(checkTestRunDocumentSize(exact)).toEqual({
      ok: true,
      bytes: TEST_RUN_DOCUMENT_MAX_BYTES,
    });
    expect(checkTestRunDocumentSize({ value: `${exact.value}x` })).toEqual({
      ok: false,
      code: 'RUN_DOCUMENT_TOO_LARGE',
      bytes: TEST_RUN_DOCUMENT_MAX_BYTES + 1,
      maximumBytes: TEST_RUN_DOCUMENT_MAX_BYTES,
    });
  });

  it('enforces the independent scenario cap using UTF-8 bytes rather than code units', () => {
    const prefixBytes = measureJsonUtf8Bytes({ value: '' });
    const asciiCount = TEST_RUN_SCENARIO_DOCUMENT_MAX_BYTES - prefixBytes - 2;
    const exact = { value: `${'x'.repeat(asciiCount)}ą` };
    expect(measureJsonUtf8Bytes(exact)).toBe(TEST_RUN_SCENARIO_DOCUMENT_MAX_BYTES);
    expect(checkTestRunScenarioDocumentSize(exact)).toMatchObject({ ok: true });
    expect(checkTestRunScenarioDocumentSize({ value: `${exact.value}x` })).toMatchObject({
      ok: false,
      code: 'SCENARIO_DOCUMENT_TOO_LARGE',
    });
  });
});
