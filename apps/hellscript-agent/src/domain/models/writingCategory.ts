export type WritingCategory = 'threads' | 'linkedin' | 'general';

const VALID_CATEGORIES = new Set<string>(['threads', 'linkedin', 'general']);

export function isValidCategory(value: string): value is WritingCategory {
  return VALID_CATEGORIES.has(value);
}
