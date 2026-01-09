import type { CommandType } from '../models/command.js';
import type { ResearchModel } from '@intexuraos/llm-contract';

export interface ClassificationResult {
  type: CommandType;
  confidence: number;
  title: string;
  reasoning: string;
  selectedModels?: ResearchModel[];
}

export interface Classifier {
  classify(text: string): Promise<ClassificationResult>;
}

export type ClassifierFactory = (apiKey: string, userId: string) => Classifier;
