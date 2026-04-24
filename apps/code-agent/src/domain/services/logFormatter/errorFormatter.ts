export const SYSTEM_REMINDER_BLOCK = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
export const TOOL_USE_ERROR_BLOCK = /<tool_use_error>([\s\S]*?)<\/tool_use_error>/gi;

export function stripSystemReminders(input: string): string {
  if (!input.includes('<system-reminder>')) return input;
  const withoutReminder = input.replace(SYSTEM_REMINDER_BLOCK, '');
  return withoutReminder.replace(/\n{2,}/g, '\n').trimEnd();
}

export function renderIndentedToolResult(trimmedContent: string, prefix: string): string {
  const MAX_TOOL_RESULT_CHARS = 2048;
  const HEAD_LINES = 10;
  const TAIL_LINES = 40;

  let lines = trimmedContent.split('\n');

  if (trimmedContent.length > MAX_TOOL_RESULT_CHARS && lines.length > HEAD_LINES + TAIL_LINES) {
    const head = lines.slice(0, HEAD_LINES);
    const tail = lines.slice(-TAIL_LINES);
    const omitted = lines.length - HEAD_LINES - TAIL_LINES;
    lines = [...head, `[... ${String(omitted)} lines omitted ...]`, ...tail];
  }

  return lines
    .map((line, index) => (index === 0 ? `${prefix}${line}` : `    ${line}`))
    .join('\n');
}

export function formatErrorToolResult(content: string): string {
  const trimmed = stripSystemReminders(content).replace(TOOL_USE_ERROR_BLOCK, '$1').trim();
  if (trimmed === '') return '';
  return renderIndentedToolResult(trimmed, '  ✗ ');
}
