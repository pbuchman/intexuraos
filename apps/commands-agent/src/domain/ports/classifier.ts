import type { CommandType, CommandSourceType } from '../models/command.js';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

export interface ClassificationResult {
  type: CommandType;
  confidence: number;
  title: string;
  reasoning: string;
}

export interface ClassifyOptions {
  sourceType?: CommandSourceType;
}

export interface Classifier {
  classify(text: string, options?: ClassifyOptions): Promise<ClassificationResult>;
}

export type ClassifierFactory = (client: LlmGenerateClient) => Classifier;
