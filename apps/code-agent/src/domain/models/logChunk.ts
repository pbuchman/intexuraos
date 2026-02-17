import { Timestamp } from '@google-cloud/firestore';

/**
 * Log chunk stored in subcollection.
 * Design reference: Lines 2027-2033
 *
 * Collection: code_tasks/{taskId}/logs
 * Document ID: Auto-generated, ordered by sequence
 */
export interface LogChunk {
  id: string;
  sequence: number;       // Ordering key
  content: string;        // Log content (may contain ANSI codes)
  timestamp: Timestamp;
  size: number;           // Byte size of content
}
