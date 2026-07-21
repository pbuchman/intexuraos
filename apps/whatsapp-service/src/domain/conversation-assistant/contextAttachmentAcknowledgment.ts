import type {
  ConversationAssistantContextAttachmentCounts,
} from './types.js';

export interface ConversationAssistantContextAttachmentAcknowledgmentInput {
  counts: ConversationAssistantContextAttachmentCounts;
  eventRange?: { from: string; to: string };
  captureRange: { from: string; to: string };
  capturedAt: string;
  displayTimeZone: string;
}

export function buildConversationAssistantContextAttachmentAcknowledgment(
  input: ConversationAssistantContextAttachmentAcknowledgmentInput
): string {
  const timeZone = resolveTimeZone(input.displayTimeZone);
  const sourceCorrectionCount =
    input.counts.edited +
    input.counts.redacted +
    input.counts.deleted +
    input.counts.reactionsChanged;
  const updateCount = input.counts.completedTranscriptions + sourceCorrectionCount;

  if (input.counts.included > 0) {
    const eventRange = input.eventRange ?? input.captureRange;
    const messageSentence =
      input.counts.included === 1
        ? `Added 1 new message sent at ${formatDateTime(eventRange.from, timeZone)}.`
        : `Added ${String(input.counts.included)} new messages sent between ${formatDateTime(eventRange.from, timeZone)} and ${formatDateTime(eventRange.to, timeZone)}.`;
    return joinSentences([
      messageSentence,
      `The snapshot was captured at ${formatTime(input.capturedAt, timeZone)}.`,
      omittedSentence(input.counts.omitted),
      includedUpdatesSentence(input.counts, sourceCorrectionCount),
    ]);
  }

  const checkedRange = `I checked from ${formatDateTime(input.captureRange.from, timeZone)} through ${formatDateTime(input.capturedAt, timeZone)}`;
  if (updateCount === 0) {
    return joinSentences([
      'Added 0 messages.',
      `${checkedRange} and found no new analyzable messages.`,
      omittedSentence(input.counts.omitted),
    ]);
  }

  return joinSentences([
    'Added 0 new messages.',
    `Applied ${String(updateCount)} ${plural(updateCount, 'update', 'updates')} to earlier context.`,
    `${checkedRange}.`,
    omittedSentence(input.counts.omitted),
    correctionsOnlyBreakdownSentence(input.counts, updateCount),
  ]);
}

function includedUpdatesSentence(
  counts: ConversationAssistantContextAttachmentCounts,
  sourceCorrectionCount: number
): string | undefined {
  const summary: string[] = [];
  if (counts.completedTranscriptions > 0) {
    summary.push(
      `${String(counts.completedTranscriptions)} ${plural(
        counts.completedTranscriptions,
        'completed transcription',
        'completed transcriptions'
      )}`
    );
  }
  if (sourceCorrectionCount > 0) {
    summary.push(
      `${String(sourceCorrectionCount)} ${plural(
        sourceCorrectionCount,
        'source correction',
        'source corrections'
      )}`
    );
  }
  if (summary.length === 0) return undefined;

  const sourceBreakdown = sourceCorrectionBreakdown(counts);
  const breakdownSuffix =
    sourceBreakdown.length === 0 ? '' : ` (${formatList(sourceBreakdown)})`;
  return `Also applied ${formatList(summary)}${breakdownSuffix}.`;
}

function correctionsOnlyBreakdownSentence(
  counts: ConversationAssistantContextAttachmentCounts,
  updateCount: number
): string {
  const breakdown = completedTranscriptionBreakdown(counts).concat(
    sourceCorrectionBreakdown(counts)
  );
  return `The ${plural(updateCount, 'update was', 'updates were')} ${formatList(breakdown)}.`;
}

function completedTranscriptionBreakdown(
  counts: ConversationAssistantContextAttachmentCounts
): string[] {
  return counts.completedTranscriptions === 0
    ? []
    : [
        `${String(counts.completedTranscriptions)} ${plural(
          counts.completedTranscriptions,
          'completed transcription',
          'completed transcriptions'
        )}`,
      ];
}

function sourceCorrectionBreakdown(
  counts: ConversationAssistantContextAttachmentCounts
): string[] {
  return [
    countLabel(counts.edited, 'edit', 'edits'),
    countLabel(counts.redacted + counts.deleted, 'redaction', 'redactions'),
    countLabel(counts.reactionsChanged, 'reaction change', 'reaction changes'),
  ].filter((value): value is string => value !== undefined);
}

function countLabel(count: number, singular: string, pluralLabel: string): string | undefined {
  return count === 0 ? undefined : `${String(count)} ${plural(count, singular, pluralLabel)}`;
}

function omittedSentence(count: number): string | undefined {
  if (count === 0) return undefined;
  return count === 1
    ? '1 item was excluded because it had no analyzable content.'
    : `${String(count)} items were excluded because they had no analyzable content.`;
}

function plural(count: number, singular: string, pluralLabel: string): string {
  return count === 1 ? singular : pluralLabel;
}

function formatList(values: readonly string[]): string {
  if (values.length <= 1) return values.join('');
  if (values.length === 2) return values.join(' and ');
  return `${values.slice(0, -1).join(', ')}, and ${values.slice(-1).join('')}`;
}

function joinSentences(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined).join(' ');
}

function resolveTimeZone(displayTimeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: displayTimeZone }).format(0);
    return displayTimeZone;
  } catch {
    return 'UTC';
  }
}

function formatDateTime(timestamp: string, timeZone: string): string {
  const value = new Date(timestamp);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(value);
  return `${date}, ${formatTime(timestamp, timeZone)}`;
}

function formatTime(timestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}
