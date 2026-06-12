/**
 * Utility for filtering and deduplicating raw mobile notifications.
 */

export interface RawNotification {
  sender?: string | null;
  text: string;
  postTime: string; // Unix epoch seconds as string
  title: string;
  app: string;
}

export interface CleanMessage {
  senderLabel?: string | null;
  text: string;
  postTimeSec: number;
}

interface ParsedMessage {
  message: CleanMessage;
  dedupeSenderLabel: string;
}

const META_PATTERNS: RegExp[] = [
  /^\(\d+\s+new\s+messages\)$/,
  /^\d+\s+new\s+messages$/,
  /^\d+\s+messages\s+in\s+\d+\s+chats$/,
  /^\d+\s+photos$/,
  /^\d+\s+videos$/,
  /^\d+\s+attachments$/,
];

const DEDUP_WINDOW_SEC = 90;

function isMetaRow(text: string): boolean {
  return META_PATTERNS.some((pattern) => pattern.test(text));
}

export function filterAndDedupeNotifications(
  raw: readonly RawNotification[]
): CleanMessage[] {
  // Parse and drop invalid postTime and meta rows
  const parsed: ParsedMessage[] = [];
  for (const notification of raw) {
    if (isMetaRow(notification.text)) {
      continue;
    }
    const postTimeSec = parseInt(notification.postTime, 10);
    if (!Number.isFinite(postTimeSec)) {
      continue;
    }
    const message: CleanMessage =
      notification.sender === undefined
        ? { text: notification.text, postTimeSec }
        : { senderLabel: notification.sender, text: notification.text, postTimeSec };
    parsed.push({
      message,
      dedupeSenderLabel: notification.sender ?? notification.title,
    });
  }

  // Sort ascending by postTimeSec for dedup processing
  parsed.sort((a, b) => a.message.postTimeSec - b.message.postTimeSec);

  // Deduplicate: for each (sender label, text) pair, drop any notification
  // that is within 90 seconds of an earlier one we are keeping.
  const kept: CleanMessage[] = [];
  // Track the postTimeSec of the last kept notification per (sender label, text) key
  const lastKeptTime = new Map<string, number>();

  for (const { message, dedupeSenderLabel } of parsed) {
    const key = `${dedupeSenderLabel}\x00${message.text}`;
    const lastTime = lastKeptTime.get(key);
    if (
      lastTime !== undefined &&
      Math.abs(message.postTimeSec - lastTime) <= DEDUP_WINDOW_SEC
    ) {
      continue;
    }
    lastKeptTime.set(key, message.postTimeSec);
    kept.push(message);
  }

  return kept;
}
