import type { Result } from '@intexuraos/common-core';
import type { WritingCategory } from '../models/writingCategory.js';
import type { WritingStyleConfig } from '../models/writingStyleConfig.js';
import type { WritingSample } from '../models/writingSample.js';

export interface WritingConfigRepository {
  getStyleConfig(userId: string): Promise<Result<WritingStyleConfig | null>>;
  upsertStyleInstructions(
    userId: string,
    category: WritingCategory,
    text: string
  ): Promise<Result<void>>;
  deleteStyleInstructions(userId: string, category: WritingCategory): Promise<Result<void>>;
  listSamples(userId: string, category: WritingCategory): Promise<Result<WritingSample[]>>;
  getSample(userId: string, sampleId: string): Promise<Result<WritingSample | null>>;
  createSample(
    userId: string,
    sample: Omit<WritingSample, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Result<WritingSample>>;
  updateSample(
    userId: string,
    sampleId: string,
    category: WritingCategory,
    title: string,
    text: string
  ): Promise<Result<void>>;
  deleteSample(
    userId: string,
    sampleId: string,
    category: WritingCategory
  ): Promise<Result<void>>;
  countSamplesByCategory(userId: string, category: WritingCategory): Promise<Result<number>>;
}
