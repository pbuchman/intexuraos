import type { CommandType } from '../models/command.js';
import type { LlmProvider } from '../events/actionCreatedEvent.js';

export interface ClassificationResult {
  type: CommandType;
  confidence: number;
  title: string;
  selectedLlms?: LlmProvider[];
}

export interface Classifier {
  classify(text: string): Promise<ClassificationResult>;
}

export type ClassifierFactory = (apiKey: string) => Classifier;
