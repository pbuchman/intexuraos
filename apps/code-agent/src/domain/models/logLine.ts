import type { Timestamp } from '@google-cloud/firestore';

export interface FormattedLogLine {
  sequence: number;
  text: string;
  timestamp: Timestamp;
}
