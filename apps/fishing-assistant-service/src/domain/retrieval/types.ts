import type { FishingEvidenceSourceType } from '../models/chat.js';

export interface EvidenceItem {
  id: string;
  sourceType: FishingEvidenceSourceType;
  title: string;
  date?: string;
  heading?: string;
  text: string;
  quote: string;
  url?: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export type RetrievalError =
  | { code: 'NO_EVIDENCE'; message: string }
  | { code: 'DOWNSTREAM_ERROR'; message: string };
