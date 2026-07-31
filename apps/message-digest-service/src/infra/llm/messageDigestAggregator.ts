import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  buildMessageDigestAggregatePrompt,
  buildMessageDigestRepairPrompt,
  buildMessageDigestSynthesisPrompt,
  createMessageDigestAggregateSchema,
  MESSAGE_DIGEST_AGGREGATE_PROMPT,
  MESSAGE_DIGEST_REPAIR_PROMPT,
  MESSAGE_DIGEST_SYNTHESIS_PROMPT,
  type MessageDigestAggregate,
  type MessageDigestSourceMessage,
} from '@intexuraos/llm-prompts';
import type {
  MessageDigestAggregationInput,
  MessageDigestAggregationMetadata,
  MessageDigestAggregationResult,
  MessageDigestAggregator,
} from '../../domain/ports/messageDigestClients.js';

const DEFAULT_MAX_CHUNK_CHARS = 60_000;
const DEFAULT_MAX_SOURCE_CHARS = 240_000;
const MAX_SOURCE_MESSAGES = 5_000;
const MAX_SYNTHESIS_PROMPT_CHARS = 256_000;
const RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'message_digest_aggregate',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'summaryMarkdown', 'evidenceMessageRefs', 'continuityMemoryMarkdown'],
      properties: {
        headline: { type: 'string' },
        summaryMarkdown: { type: 'string' },
        evidenceMessageRefs: {
          type: 'array',
          items: { type: 'string' },
        },
        continuityMemoryMarkdown: { type: 'string' },
      },
    },
  },
};

export interface MessageDigestAggregatorConfig {
  createLlmClient(userId: string): Pick<LlmGenerateClient, 'generate'>;
  model: string;
  maxChunkChars?: number | undefined;
  maxSourceChars?: number | undefined;
}

interface GeneratedAggregate {
  aggregate: MessageDigestAggregate;
  usage: MessageDigestAggregationMetadata['usage'];
  promptIdentity: string;
}

export function createMessageDigestAggregator(
  config: MessageDigestAggregatorConfig
): MessageDigestAggregator {
  const maxChunkChars = config.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const maxSourceChars = config.maxSourceChars ?? DEFAULT_MAX_SOURCE_CHARS;
  if (maxChunkChars < 1 || maxSourceChars < maxChunkChars) {
    throw new Error('Invalid Message Digest aggregation limits');
  }

  return {
    async aggregate(input): Promise<MessageDigestAggregationResult> {
      const messages = stableMessages(input.messages);
      const emptyMetadata = metadata(
        config.model,
        messages.length,
        zeroUsage(),
        promptIdentity(MESSAGE_DIGEST_AGGREGATE_PROMPT)
      );
      if (messages.length === 0) {
        return { ok: true, kind: 'empty', aggregate: null, metadata: emptyMetadata };
      }
      const chunks = chunkMessages(
        messages as [MessageDigestSourceMessage, ...MessageDigestSourceMessage[]],
        maxChunkChars,
        maxSourceChars
      );
      if (chunks === null) return { ok: false, code: 'SOURCE_TOO_LARGE' };

      const client = config.createLlmClient(input.userId);
      const generated: GeneratedAggregate[] = [];
      for (const chunk of chunks) {
        const result = await generateChunk(client, input, chunk);
        if (!result.ok) return result;
        generated.push(result.value);
      }
      const chunkUsage = generated.reduce(
        (total, item) => addUsage(total, item.usage),
        zeroUsage()
      );
      const [firstGenerated] = generated as [GeneratedAggregate, ...GeneratedAggregate[]];
      let final = firstGenerated;
      let usage = chunkUsage;
      if (generated.length > 1) {
        const synthesized = await synthesizeChunks(client, input, generated);
        if (!synthesized.ok) return synthesized;
        final = synthesized.value;
        usage = addUsage(chunkUsage, synthesized.value.usage);
      }
      return {
        ok: true,
        kind: 'aggregate',
        aggregate: final.aggregate,
        metadata: metadata(config.model, messages.length, usage, final.promptIdentity),
      };
    },
  };
}

async function generateChunk(
  client: Pick<LlmGenerateClient, 'generate'>,
  input: MessageDigestAggregationInput,
  messages: MessageDigestSourceMessage[]
): Promise<
  | { ok: true; value: GeneratedAggregate }
  | { ok: false; code: 'SOURCE_TOO_LARGE' | 'LLM_UNAVAILABLE' | 'INVALID_AGGREGATE' }
> {
  const prompt = buildMessageDigestAggregatePrompt({
    chatType: input.chatType,
    conversationLabel: input.conversationLabel,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    instructions: input.instructions,
    continuityMemoryMarkdown: input.continuityMemoryMarkdown,
    previousSummaries: input.previousSummaries,
    sourceMessages: messages,
  });
  const allowedRefs = new Set(messages.map((message) => message.messageRef));
  return await generateValidatedAggregate(client, {
    prompt,
    promptType: MESSAGE_DIGEST_AGGREGATE_PROMPT.promptType,
    promptVersion: MESSAGE_DIGEST_AGGREGATE_PROMPT.version,
    correlationId: input.correlationId,
    allowedRefs,
  });
}

async function synthesizeChunks(
  client: Pick<LlmGenerateClient, 'generate'>,
  input: MessageDigestAggregationInput,
  chunks: GeneratedAggregate[]
): Promise<
  | { ok: true; value: GeneratedAggregate }
  | { ok: false; code: 'SOURCE_TOO_LARGE' | 'LLM_UNAVAILABLE' | 'INVALID_AGGREGATE' }
> {
  const prompt = buildMessageDigestSynthesisPrompt({
    chatType: input.chatType,
    conversationLabel: input.conversationLabel,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    instructions: input.instructions,
    continuityMemoryMarkdown: input.continuityMemoryMarkdown,
    chunkAggregates: chunks.map((chunk) => chunk.aggregate),
  });
  if (prompt.length > MAX_SYNTHESIS_PROMPT_CHARS) {
    return { ok: false, code: 'SOURCE_TOO_LARGE' };
  }
  const allowedRefs = new Set(
    chunks.flatMap((chunk) => chunk.aggregate.evidenceMessageRefs)
  );
  return await generateValidatedAggregate(client, {
    prompt,
    promptType: MESSAGE_DIGEST_SYNTHESIS_PROMPT.promptType,
    promptVersion: MESSAGE_DIGEST_SYNTHESIS_PROMPT.version,
    correlationId: input.correlationId,
    allowedRefs,
  });
}

async function generateValidatedAggregate(
  client: Pick<LlmGenerateClient, 'generate'>,
  input: {
    prompt: string;
    promptType: string;
    promptVersion: string;
    correlationId: string;
    allowedRefs: ReadonlySet<string>;
  }
): Promise<
  | { ok: true; value: GeneratedAggregate }
  | { ok: false; code: 'LLM_UNAVAILABLE' | 'INVALID_AGGREGATE' }
> {
  const { prompt, promptType, promptVersion, correlationId, allowedRefs } = input;
  const initial = await client.generate(prompt, {
    promptType,
    responseFormat: RESPONSE_FORMAT,
    correlation: { requestId: correlationId },
  });
  if (!initial.ok) return { ok: false, code: 'LLM_UNAVAILABLE' };
  const parsed = parseAggregate(initial.value.content, allowedRefs);
  if (parsed !== null) {
    return {
      ok: true,
      value: {
        aggregate: parsed,
        usage: usageOf(initial.value.usage),
        promptIdentity: promptIdentity({ promptType, version: promptVersion }),
      },
    };
  }

  const repair = await client.generate(
    buildMessageDigestRepairPrompt({
      originalPrompt: prompt,
      invalidResponse: initial.value.content.slice(0, 24_000),
      errorMessage: 'Response failed strict Message Digest validation',
      allowedEvidenceMessageRefs: [...allowedRefs],
    }),
    {
      promptType: MESSAGE_DIGEST_REPAIR_PROMPT.promptType,
      responseFormat: RESPONSE_FORMAT,
      correlation: { requestId: correlationId },
    }
  );
  if (!repair.ok) return { ok: false, code: 'LLM_UNAVAILABLE' };
  const repaired = parseAggregate(repair.value.content, allowedRefs);
  if (repaired === null) return { ok: false, code: 'INVALID_AGGREGATE' };
  return {
    ok: true,
    value: {
      aggregate: repaired,
      usage: addUsage(usageOf(initial.value.usage), usageOf(repair.value.usage)),
      promptIdentity: promptIdentity(MESSAGE_DIGEST_REPAIR_PROMPT),
    },
  };
}

function parseAggregate(
  content: string,
  allowedRefs: ReadonlySet<string>
): MessageDigestAggregate | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    const summaryMarkdown =
      typeof candidate['summaryMarkdown'] === 'string'
        ? sanitizeMarkdown(candidate['summaryMarkdown'])
        : undefined;
    const continuityMemoryMarkdown =
      typeof candidate['continuityMemoryMarkdown'] === 'string'
        ? sanitizeMarkdown(candidate['continuityMemoryMarkdown'])
        : undefined;
    if (summaryMarkdown === null || continuityMemoryMarkdown === null) return null;
    const sanitized = {
      ...candidate,
      ...(typeof candidate['headline'] === 'string'
        ? { headline: sanitizeHeadline(candidate['headline']) }
        : {}),
      ...(summaryMarkdown === undefined ? {} : { summaryMarkdown }),
      ...(continuityMemoryMarkdown === undefined ? {} : { continuityMemoryMarkdown }),
    };
    const result = createMessageDigestAggregateSchema(allowedRefs).safeParse(sanitized);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function stableMessages(messages: MessageDigestSourceMessage[]): MessageDigestSourceMessage[] {
  return [...messages].sort(
    (left, right) =>
      left.eventTimestamp.localeCompare(right.eventTimestamp) ||
      left.messageRef.localeCompare(right.messageRef)
  );
}

function chunkMessages(
  messages: [MessageDigestSourceMessage, ...MessageDigestSourceMessage[]],
  maxChunkChars: number,
  maxSourceChars: number
): MessageDigestSourceMessage[][] | null {
  if (messages.length > MAX_SOURCE_MESSAGES) return null;
  const chunks: MessageDigestSourceMessage[][] = [];
  let current: MessageDigestSourceMessage[] = [];
  let currentSize = 0;
  let totalSize = 0;
  for (const message of messages) {
    const size = JSON.stringify(message).length + 1;
    totalSize += size;
    if (size > maxChunkChars || totalSize > maxSourceChars) return null;
    if (current.length > 0 && currentSize + size > maxChunkChars) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(message);
    currentSize += size;
  }
  chunks.push(current);
  return chunks;
}

function sanitizeHeadline(value: string): string {
  return sanitizeText(value).replace(/\s+/gu, ' ').trim();
}

function sanitizeMarkdown(value: string): string | null {
  const normalized = sanitizeText(value);
  if (containsUnsafeMarkdownConstruct(normalized)) return null;
  return normalized.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function containsUnsafeMarkdownConstruct(value: string): boolean {
  const gfmAutolinkLiteral =
    /(?:https?:\/\/|www\.)[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
  if (gfmAutolinkLiteral.test(value)) return true;
  if (value.split('\n').some(containsReferenceDefinition)) return true;
  for (let index = 0; index < value.length - 1; index += 1) {
    if (isEscaped(value, index)) continue;
    if (value[index] === '!' && value[index + 1] === '[') return true;
    if (value[index] !== '[') continue;
    const closingBracket = findBalancedClosingBracket(value, index);
    if (closingBracket === null) continue;
    const suffix = value[closingBracket + 1];
    if (suffix === '(' || suffix === '[') return true;
  }
  return false;
}

function containsReferenceDefinition(line: string): boolean {
  let cursor = skipIndent(line, 0, 3);
  for (;;) {
    if (line[cursor] === '>') {
      cursor = skipWhitespace(line, cursor + 1);
      continue;
    }
    if (
      (line[cursor] === '-' || line[cursor] === '+' || line[cursor] === '*') &&
      isMarkdownWhitespace(line[cursor + 1])
    ) {
      cursor = skipWhitespace(line, cursor + 2);
      continue;
    }
    const orderedMarkerEnd = findOrderedListMarkerEnd(line, cursor);
    if (orderedMarkerEnd !== null) {
      cursor = skipWhitespace(line, orderedMarkerEnd);
      continue;
    }
    break;
  }
  if (line[cursor] !== '[' || isEscaped(line, cursor)) return false;
  const closingBracket = findBalancedClosingBracket(line, cursor);
  return closingBracket !== null && line[closingBracket + 1] === ':';
}

function findBalancedClosingBracket(value: string, openingBracket: number): number | null {
  let depth = 1;
  for (let cursor = openingBracket + 1; cursor < value.length; cursor += 1) {
    if (isEscaped(value, cursor)) continue;
    if (value[cursor] === '[') depth += 1;
    if (value[cursor] !== ']') continue;
    depth -= 1;
    if (depth === 0) return cursor;
  }
  return null;
}

function findOrderedListMarkerEnd(line: string, start: number): number | null {
  let cursor = start;
  while (cursor < line.length && cursor - start < 9 && /[0-9]/u.test(line.charAt(cursor))) {
    cursor += 1;
  }
  if (cursor === start || (line[cursor] !== '.' && line[cursor] !== ')')) return null;
  return isMarkdownWhitespace(line[cursor + 1]) ? cursor + 2 : null;
}

function skipIndent(value: string, start: number, maximum: number): number {
  let cursor = start;
  while (cursor < value.length && cursor - start < maximum && value[cursor] === ' ') cursor += 1;
  return cursor;
}

function skipWhitespace(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length && isMarkdownWhitespace(value[cursor])) cursor += 1;
  return cursor;
}

function isMarkdownWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\t';
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function sanitizeText(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) as number;
      return !isUnsafeControlCodePoint(codePoint);
    })
    .join('');
}

function isUnsafeControlCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0 && codePoint <= 8) ||
    codePoint === 11 ||
    codePoint === 12 ||
    (codePoint >= 14 && codePoint <= 31) ||
    (codePoint >= 127 && codePoint <= 159) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function metadata(
  model: string,
  effectiveMessageCount: number,
  usage: MessageDigestAggregationMetadata['usage'],
  promptVersion: string
): MessageDigestAggregationMetadata {
  return {
    effectiveMessageCount,
    promptVersion,
    model,
    usage,
  };
}

function promptIdentity(prompt: { promptType: string; version: string }): string {
  return `${prompt.promptType}@${prompt.version}`;
}

function usageOf(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}): MessageDigestAggregationMetadata['usage'] {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
  };
}

function zeroUsage(): MessageDigestAggregationMetadata['usage'] {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
}

function addUsage(
  left: MessageDigestAggregationMetadata['usage'],
  right: MessageDigestAggregationMetadata['usage']
): MessageDigestAggregationMetadata['usage'] {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}
