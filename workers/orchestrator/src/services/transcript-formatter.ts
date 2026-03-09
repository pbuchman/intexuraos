export interface SessionJsonlEntry {
  type: 'user' | 'assistant';
  uuid: string;
  parentUuid: string;
  timestamp: string;
  isMeta?: boolean;
  message: {
    role: 'user' | 'assistant';
    content: ContentBlock[];
  };
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | { type: 'text'; text: string }[];
    };

const MAX_RESULT_LENGTH = 500;

function isErrorResult(content: string): boolean {
  return content.includes('<tool_use_error>');
}

function formatToolName(block: { name: string; input: Record<string, unknown> }): string {
  if (block.name === 'Skill') {
    const skill = block.input['skill'];
    return typeof skill === 'string' ? `Skill(${skill})` : 'Skill';
  }
  if (block.name === 'Agent') {
    const subType = block.input['subagent_type'];
    return typeof subType === 'string' ? `Agent(${subType})` : 'Agent';
  }
  return block.name;
}

function formatInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input)
    .filter(([key]) => key !== 'subagent_type') // already shown in tool name
    .map(([key, value]) => {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      const truncated = str.length > 200 ? str.slice(0, 200) + '...' : str;
      return `${key}: "${truncated}"`;
    });
  return entries.join(', ');
}

function extractToolResultText(content: string | { type: 'text'; text: string }[]): string {
  if (typeof content === 'string') return content;
  return content.map((c) => c.text).join('\n');
}

export function formatTranscript(entries: SessionJsonlEntry[]): string {
  if (entries.length === 0) return '';

  const lines: string[] = [];
  let msgNum = 0;

  for (const entry of entries) {
    msgNum++;
    const prefix = `[MSG-${String(msgNum).padStart(3, '0')}]`;
    const blocks = entry.message.content;

    for (const block of blocks) {
      if (block.type === 'text') {
        if (entry.isMeta === true) {
          lines.push(`${prefix} USER (meta/skill-content):`);
        } else {
          lines.push(`${prefix} ${entry.type.toUpperCase()} text:`);
        }
        const text =
          block.text.length > MAX_RESULT_LENGTH
            ? block.text.slice(0, MAX_RESULT_LENGTH) + ' [truncated]'
            : block.text;
        lines.push(`  ${text}`);
      } else if (block.type === 'tool_use') {
        const toolName = formatToolName(block);
        lines.push(`${prefix} ASSISTANT tool_use: ${toolName}`);
        lines.push(`  ${formatInput(block.input)}`);
      } else {
        const text = extractToolResultText(block.content);
        const hasError = isErrorResult(text);
        lines.push(
          `${prefix} USER tool_result${hasError ? ' ERROR' : ''} (for ${block.tool_use_id}):`
        );
        if (hasError || text.length <= MAX_RESULT_LENGTH) {
          lines.push(`  ${text}`);
        } else {
          lines.push(
            `  ${text.slice(0, MAX_RESULT_LENGTH)} [truncated, ${String(text.length)} chars total]`
          );
        }
      }
    }
  }

  return lines.join('\n');
}
