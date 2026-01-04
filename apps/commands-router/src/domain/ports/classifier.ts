import type { CommandType } from '../models/command.js';
import type { SupportedModel } from '@intexuraos/llm-contract';

export interface ClassificationResult {
  type: CommandType;
  confidence: number;
  title: string;
  reasoning: string;
  selectedModels?: SupportedModel[];
}

export interface Classifier {
  classify(text: string): Promise<ClassificationResult>;
}

export type ClassifierFactory = (apiKey: string) => Classifier;
