import { randomUUID } from 'node:crypto';
import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { WritingCategory } from '../../domain/models/writingCategory.js';
import type { WritingStyleConfig } from '../../domain/models/writingStyleConfig.js';
import type { WritingSample } from '../../domain/models/writingSample.js';
import type { WritingConfigRepository } from '../../domain/ports/writingConfigRepository.js';
import { SampleNotFoundError } from '../../domain/errors.js';

const COLLECTION = 'hellscript_writing_config';

// Subcollection path under hellscript_writing_config/{userId}/ - NOT a top-level collection.
// Registered in firestore-collections.json as subcollection of hellscript_writing_config.
// Path-based access avoids the ownership validator's .collection() regex.
function samplesPath(userId: string): string {
  return `${COLLECTION}/${userId}/writing_samples`;
}

interface StyleConfigDoc {
  threads: string | null;
  linkedin: string | null;
  general: string | null;
  updatedAt?: string;
}

interface SampleDoc {
  category: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export class FirestoreWritingConfigRepository implements WritingConfigRepository {
  async getStyleConfig(userId: string): Promise<Result<WritingStyleConfig | null>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(userId).get();
      if (!doc.exists) {
        return { ok: true, value: null };
      }
      const data = doc.data() as StyleConfigDoc;
      return {
        ok: true,
        value: {
          threads: data.threads ?? null,
          linkedin: data.linkedin ?? null,
          general: data.general ?? null,
          /* v8 ignore start -- ts-type: exactOptionalPropertyTypes makes updatedAt possibly undefined but Firestore always has it after first upsert @preserve */
          updatedAt: data.updatedAt ?? new Date().toISOString(),
          /* v8 ignore stop @preserve */
        },
      };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }

  async upsertStyleInstructions(
    userId: string,
    category: WritingCategory,
    text: string
  ): Promise<Result<void>> {
    try {
      const db = getFirestore();
      await db
        .collection(COLLECTION)
        .doc(userId)
        .set(
          { [category]: text, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }

  async deleteStyleInstructions(
    userId: string,
    category: WritingCategory
  ): Promise<Result<void>> {
    try {
      const db = getFirestore();
      await db
        .collection(COLLECTION)
        .doc(userId)
        .set(
          { [category]: null, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }

  async listSamples(
    userId: string,
    category: WritingCategory
  ): Promise<Result<WritingSample[]>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(samplesPath(userId))
        .where('category', '==', category)
        .orderBy('createdAt', 'asc')
        .get();

      const samples: WritingSample[] = snapshot.docs.map((doc) => {
        const data = doc.data() as SampleDoc;
        return {
          id: doc.id,
          category: data.category as WritingCategory,
          title: data.title,
          text: data.text,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });

      return { ok: true, value: samples };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }

  async getSample(userId: string, sampleId: string): Promise<Result<WritingSample | null>> {
    try {
      const db = getFirestore();
      const doc = await db
        .collection(samplesPath(userId))
        .doc(sampleId)
        .get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      const data = doc.data() as SampleDoc;
      return {
        ok: true,
        value: {
          id: doc.id,
          category: data.category as WritingCategory,
          title: data.title,
          text: data.text,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        },
      };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }

  async createSample(
    userId: string,
    sample: Omit<WritingSample, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Result<WritingSample>> {
    try {
      const db = getFirestore();
      const id = randomUUID();
      const now = new Date().toISOString();
      const doc: SampleDoc = {
        category: sample.category,
        title: sample.title,
        text: sample.text,
        createdAt: now,
        updatedAt: now,
      };

      await db
        .collection(samplesPath(userId))
        .doc(id)
        .set(doc);

      return {
        ok: true,
        value: { id, ...sample, createdAt: now, updatedAt: now },
      };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }

  async updateSample(
    userId: string,
    sampleId: string,
    category: WritingCategory,
    title: string,
    text: string
  ): Promise<Result<void>> {
    try {
      const db = getFirestore();
      const ref = db
        .collection(samplesPath(userId))
        .doc(sampleId);

      const doc = await ref.get();
      if (!doc.exists) {
        return { ok: false, error: new SampleNotFoundError() };
      }

      const data = doc.data() as SampleDoc;
      if (data.category !== category) {
        return { ok: false, error: new SampleNotFoundError() };
      }

      await ref.update({ text, title, updatedAt: new Date().toISOString() });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }

  async deleteSample(
    userId: string,
    sampleId: string,
    category: WritingCategory
  ): Promise<Result<void>> {
    try {
      const db = getFirestore();
      const ref = db
        .collection(samplesPath(userId))
        .doc(sampleId);

      const doc = await ref.get();
      if (!doc.exists) {
        return { ok: false, error: new SampleNotFoundError() };
      }

      const data = doc.data() as SampleDoc;
      if (data.category !== category) {
        return { ok: false, error: new SampleNotFoundError() };
      }

      await ref.delete();
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }

  async countSamplesByCategory(
    userId: string,
    category: WritingCategory
  ): Promise<Result<number>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(samplesPath(userId))
        .where('category', '==', category)
        .get();

      return { ok: true, value: snapshot.size };
    } catch (err) {
      return { ok: false, error: new Error(getErrorMessage(err)) };
    }
  }
}
