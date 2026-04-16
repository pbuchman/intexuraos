/**
 * Utility for filtering and deduplicating raw mobile notifications.
 */

export interface RawNotification {
  sender: string;
  text: string;
  postTime: string; // Unix epoch seconds as string
  title: string;
  app: string;
}

export interface CleanMessage {
  sender: string;
  text: string;
  postTimeSec: number;
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
  const parsed: CleanMessage[] = [];
  for (const notification of raw) {
    if (isMetaRow(notification.text)) {
      continue;
    }
    const postTimeSec = parseInt(notification.postTime, 10);
    if (!Number.isFinite(postTimeSec)) {
      continue;
    }
    parsed.push({ sender: notification.sender, text: notification.text, postTimeSec });
  }

  // Sort ascending by postTimeSec for dedup processing
  parsed.sort((a, b) => a.postTimeSec - b.postTimeSec);

  // Deduplicate: for each (sender, text) pair, drop any notification
  // that is within 90 seconds of an earlier one we are keeping.
  const kept: CleanMessage[] = [];
  // Track the postTimeSec of the last kept notification per (sender, text) key
  const lastKeptTime = new Map<string, number>();

  for (const msg of parsed) {
    const key = `${msg.sender}\x00${msg.text}`;
    const lastTime = lastKeptTime.get(key);
    if (lastTime !== undefined && Math.abs(msg.postTimeSec - lastTime) <= DEDUP_WINDOW_SEC) {
      continue;
    }
    lastKeptTime.set(key, msg.postTimeSec);
    kept.push(msg);
  }

  return kept;
}
