import type { WritingCategory } from './writingCategory.js';

export interface WritingSample {
  id: string;
  category: WritingCategory;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}
