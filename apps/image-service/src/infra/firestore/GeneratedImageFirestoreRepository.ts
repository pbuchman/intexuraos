import { getFirestore } from '@intexuraos/infra-firestore';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { GeneratedImage } from '../../domain/index.js';
import type {
  GeneratedImageRepository,
  RepositoryError,
} from '../../domain/ports/generatedImageRepository.js';

const COLLECTION_NAME = 'generated_images';

interface GeneratedImageDocument {
  id: string;
  prompt: string;
  thumbnailUrl: string;
  fullSizeUrl: string;
  model: string;
  createdAt: string;
}

export class GeneratedImageFirestoreRepository implements GeneratedImageRepository {
  async save(image: GeneratedImage): Promise<Result<GeneratedImage, RepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(image.id);

      const doc: GeneratedImageDocument = {
        id: image.id,
        prompt: image.prompt,
        thumbnailUrl: image.thumbnailUrl,
        fullSizeUrl: image.fullSizeUrl,
        model: image.model,
        createdAt: image.createdAt,
      };

      await docRef.set(doc);
      return ok(image);
    } catch (error) {
      return err({
        code: 'WRITE_FAILED',
        message: getErrorMessage(error),
      });
    }
  }

  async findById(id: string): Promise<Result<GeneratedImage, RepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err({
          code: 'NOT_FOUND',
          message: `Generated image with id ${id} not found`,
        });
      }

      const data = snapshot.data() as GeneratedImageDocument;
      return ok({
        id: data.id,
        prompt: data.prompt,
        thumbnailUrl: data.thumbnailUrl,
        fullSizeUrl: data.fullSizeUrl,
        model: data.model,
        createdAt: data.createdAt,
      });
    } catch (error) {
      return err({
        code: 'READ_FAILED',
        message: getErrorMessage(error),
      });
    }
  }
}

export function createGeneratedImageRepository(): GeneratedImageRepository {
  return new GeneratedImageFirestoreRepository();
}
