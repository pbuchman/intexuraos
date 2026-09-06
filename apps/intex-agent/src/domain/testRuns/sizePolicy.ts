export const TEST_RUN_DOCUMENT_MAX_BYTES = 64 * 1024;
export const TEST_RUN_SCENARIO_DOCUMENT_MAX_BYTES = 128 * 1024;

export type TestRunDocumentSizeResult =
  | Readonly<{ ok: true; bytes: number }>
  | Readonly<{
      ok: false;
      code: 'RUN_DOCUMENT_TOO_LARGE' | 'SCENARIO_DOCUMENT_TOO_LARGE';
      bytes: number;
      maximumBytes: number;
    }>;

export function measureJsonUtf8Bytes(value: unknown): number {
  const serialized = JSON.stringify(value) as string | undefined;
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable');
  return Buffer.byteLength(serialized, 'utf8');
}

export function checkTestRunDocumentSize(value: unknown): TestRunDocumentSizeResult {
  return checkSize(value, TEST_RUN_DOCUMENT_MAX_BYTES, 'RUN_DOCUMENT_TOO_LARGE');
}

export function checkTestRunScenarioDocumentSize(value: unknown): TestRunDocumentSizeResult {
  return checkSize(
    value,
    TEST_RUN_SCENARIO_DOCUMENT_MAX_BYTES,
    'SCENARIO_DOCUMENT_TOO_LARGE'
  );
}

function checkSize(
  value: unknown,
  maximumBytes: number,
  code: 'RUN_DOCUMENT_TOO_LARGE' | 'SCENARIO_DOCUMENT_TOO_LARGE'
): TestRunDocumentSizeResult {
  const bytes = measureJsonUtf8Bytes(value);
  return bytes <= maximumBytes
    ? { ok: true, bytes }
    : { ok: false, code, bytes, maximumBytes };
}
