import { randomUUID } from 'node:crypto';
import type { Result } from '@intexuraos/common-core';
import type { WritingCategory } from '../domain/models/writingCategory.js';
import type { WritingStyleConfig } from '../domain/models/writingStyleConfig.js';
import type { WritingSample } from '../domain/models/writingSample.js';
import type { WritingConfigRepository } from '../domain/ports/writingConfigRepository.js';

type MethodName =
  | 'getStyleConfig'
  | 'upsertStyleInstructions'
  | 'deleteStyleInstructions'
  | 'listSamples'
  | 'getSample'
  | 'createSample'
  | 'updateSample'
  | 'deleteSample'
  | 'countSamplesByCategory';

export class FakeWritingConfigRepository implements WritingConfigRepository {
  private configs = new Map<string, WritingStyleConfig>();
  private samples = new Map<string, WritingSample[]>();
  private methodErrors = new Map<MethodName, Error>();

  simulateMethodError(method: MethodName, error: Error): void {
    this.methodErrors.set(method, error);
  }

  private checkError(method: MethodName): Error | null {
    const error = this.methodErrors.get(method);
    if (error !== undefined) {
      this.methodErrors.delete(method);
      return error;
    }
    return null;
  }

  async getStyleConfig(userId: string): Promise<Result<WritingStyleConfig | null>> {
    const error = this.checkError('getStyleConfig');
    if (error !== null) return { ok: false, error };
    return { ok: true, value: this.configs.get(userId) ?? null };
  }

  async upsertStyleInstructions(
    userId: string,
    category: WritingCategory,
    text: string
  ): Promise<Result<void>> {
    const error = this.checkError('upsertStyleInstructions');
    if (error !== null) return { ok: false, error };

    const existing = this.configs.get(userId) ?? {
      threads: null,
      linkedin: null,
      general: null,
      updatedAt: new Date().toISOString(),
    };
    existing[category] = text;
    existing.updatedAt = new Date().toISOString();
    this.configs.set(userId, existing);
    return { ok: true, value: undefined };
  }

  async deleteStyleInstructions(
    userId: string,
    category: WritingCategory
  ): Promise<Result<void>> {
    const error = this.checkError('deleteStyleInstructions');
    if (error !== null) return { ok: false, error };

    const existing = this.configs.get(userId);
    if (existing !== undefined) {
      existing[category] = null;
      existing.updatedAt = new Date().toISOString();
    }
    return { ok: true, value: undefined };
  }

  async listSamples(
    userId: string,
    category: WritingCategory
  ): Promise<Result<WritingSample[]>> {
    const error = this.checkError('listSamples');
    if (error !== null) return { ok: false, error };

    const all = this.samples.get(userId) ?? [];
    return { ok: true, value: all.filter((s) => s.category === category) };
  }

  async getSample(userId: string, sampleId: string): Promise<Result<WritingSample | null>> {
    const error = this.checkError('getSample');
    if (error !== null) return { ok: false, error };

    const all = this.samples.get(userId) ?? [];
    return { ok: true, value: all.find((s) => s.id === sampleId) ?? null };
  }

  async createSample(
    userId: string,
    sample: Omit<WritingSample, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Result<WritingSample>> {
    const error = this.checkError('createSample');
    if (error !== null) return { ok: false, error };

    const now = new Date().toISOString();
    const full: WritingSample = {
      id: randomUUID(),
      ...sample,
      createdAt: now,
      updatedAt: now,
    };
    const existing = this.samples.get(userId) ?? [];
    existing.push(full);
    this.samples.set(userId, existing);
    return { ok: true, value: full };
  }

  async updateSample(
    userId: string,
    sampleId: string,
    category: WritingCategory,
    title: string,
    text: string
  ): Promise<Result<void>> {
    const error = this.checkError('updateSample');
    if (error !== null) return { ok: false, error };

    const all = this.samples.get(userId) ?? [];
    const sample = all.find((s) => s.id === sampleId && s.category === category);
    if (sample === undefined) {
      return { ok: false, error: new Error('Sample not found') };
    }
    sample.text = text;
    sample.title = title;
    sample.updatedAt = new Date().toISOString();
    return { ok: true, value: undefined };
  }

  async deleteSample(
    userId: string,
    sampleId: string,
    category: WritingCategory
  ): Promise<Result<void>> {
    const error = this.checkError('deleteSample');
    if (error !== null) return { ok: false, error };

    const all = this.samples.get(userId) ?? [];
    const idx = all.findIndex((s) => s.id === sampleId && s.category === category);
    if (idx === -1) {
      return { ok: false, error: new Error('Sample not found') };
    }
    all.splice(idx, 1);
    return { ok: true, value: undefined };
  }

  async countSamplesByCategory(
    userId: string,
    category: WritingCategory
  ): Promise<Result<number>> {
    const error = this.checkError('countSamplesByCategory');
    if (error !== null) return { ok: false, error };

    const all = this.samples.get(userId) ?? [];
    return { ok: true, value: all.filter((s) => s.category === category).length };
  }

  clear(): void {
    this.configs.clear();
    this.samples.clear();
  }
}
