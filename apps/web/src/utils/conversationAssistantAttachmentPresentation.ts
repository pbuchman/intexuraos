import type { ConversationAssistantOmittedCounts } from '@/types';

export function omittedContextLabel(
  omitted: ConversationAssistantOmittedCounts | undefined
): string | null {
  if (omitted === undefined) return null;

  const items = [
    formatOmission(omitted.mediaOnly, 'media item without usable text', 'media items without usable text'),
    formatOmission(omitted.failedTranscriptions, 'failed transcription', 'failed transcriptions'),
    formatOmission(
      omitted.pendingTranscriptions,
      'transcription not ready',
      'transcriptions not ready'
    ),
    formatOmission(omitted.nonText, 'unsupported message type', 'unsupported message types'),
    formatOmission(
      omitted.overLimit,
      'item outside the context limit',
      'items outside the context limit'
    ),
  ].filter((item): item is string => item !== null);

  return items.length === 0 ? null : `Omitted: ${items.join(' · ')}`;
}

function formatOmission(count: number, singular: string, plural: string): string | null {
  if (count === 0) return null;
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}
