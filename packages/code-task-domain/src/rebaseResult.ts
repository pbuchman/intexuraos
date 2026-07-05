export type CodeTaskRebaseResult =
  | { attempted: false; reason: 'not_required' }
  | { attempted: true; success: true; conflictFiles: string[] }
  | { attempted: true; success: false; conflictFiles: string[] };

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === 'string') ? value : undefined;
}

export function parseCodeTaskRebaseResult(value: unknown): CodeTaskRebaseResult | undefined {
  if (value === 'skipped') return { attempted: false, reason: 'not_required' };
  if (value === 'success') return { attempted: true, success: true, conflictFiles: [] };
  if (value === 'conflict') return { attempted: true, success: false, conflictFiles: [] };

  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;

  if (record['attempted'] === false) {
    if (record['success'] !== undefined) return undefined;
    return { attempted: false, reason: 'not_required' };
  }

  if (record['attempted'] !== true || typeof record['success'] !== 'boolean') {
    return undefined;
  }

  const conflictFiles = stringArray(record['conflictFiles']);
  if (conflictFiles === undefined) return undefined;

  return record['success']
    ? { attempted: true, success: true, conflictFiles }
    : { attempted: true, success: false, conflictFiles };
}

export function isRebaseClean(result: CodeTaskRebaseResult | undefined): boolean {
  if (result === undefined) return false;
  if (!result.attempted) return true;
  return result.success;
}
