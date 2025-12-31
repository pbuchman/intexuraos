import type { CommandType } from '../models/command.js';

export interface ClassificationResult {
  type: CommandType;
  confidence: number;
  title: string;
}

export interface Classifier {
  classify(text: string): Promise<ClassificationResult>;
}
