export const NOTION_ERROR_CODES = [
  'NOT_FOUND',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
] as const;

export type NotionErrorCodeRuntime = (typeof NOTION_ERROR_CODES)[number];

export function isNotionErrorCode(value: string): value is NotionErrorCodeRuntime {
  return (NOTION_ERROR_CODES as readonly string[]).includes(value);
}
