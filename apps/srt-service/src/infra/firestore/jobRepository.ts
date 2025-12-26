/**
 * Firestore Repository for Transcription Jobs.
 */
import { ok, err, type Result, getErrorMessage, getFirestore } from '@intexuraos/common';
import { randomUUID } from 'node:crypto';
import type {
  TranscriptionJob,
  TranscriptionJobRepository,
  TranscriptionError,
} from '../../domain/transcription/index.js';

const COLLECTION_NAME = 'transcription_jobs';

/**
 * Firestore implementation of TranscriptionJobRepository.
 */
export class FirestoreJobRepository implements TranscriptionJobRepository {
  async create(
    job: Omit<TranscriptionJob, 'id'>
  ): Promise<Result<TranscriptionJob, TranscriptionError>> {
    try {
      const db = getFirestore();
      const id = randomUUID();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const fullJob: TranscriptionJob = { id, ...job };
      await docRef.set(fullJob);
      return ok(fullJob);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to create job: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getById(id: string): Promise<Result<TranscriptionJob | null, TranscriptionError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION_NAME).doc(id).get();
      if (!doc.exists) return ok(null);
      return ok(doc.data() as TranscriptionJob);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to get job: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async findByMediaKey(
    messageId: string,
    mediaId: string
  ): Promise<Result<TranscriptionJob | null, TranscriptionError>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('messageId', '==', messageId)
        .where('mediaId', '==', mediaId)
        .limit(1)
        .get();

      if (snapshot.empty) return ok(null);

      const doc = snapshot.docs[0];
      if (doc === undefined) return ok(null);

      return ok(doc.data() as TranscriptionJob);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to find job: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async update(
    id: string,
    updates: Partial<
      Pick<
        TranscriptionJob,
        | 'status'
        | 'speechmaticsJobId'
        | 'transcript'
        | 'error'
        | 'pollAttempts'
        | 'nextPollAt'
        | 'completedAt'
        | 'updatedAt'
      >
    >
  ): Promise<Result<TranscriptionJob, TranscriptionError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);

      // Always update updatedAt
      const updateData = {
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      await docRef.update(updateData);

      const doc = await docRef.get();
      if (!doc.exists) {
        return err({
          code: 'NOT_FOUND',
          message: `Job ${id} not found`,
        });
      }

      return ok(doc.data() as TranscriptionJob);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to update job: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getJobsReadyToPoll(limit = 10): Promise<Result<TranscriptionJob[], TranscriptionError>> {
    try {
      const db = getFirestore();
      const now = new Date().toISOString();

      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('status', '==', 'processing')
        .where('nextPollAt', '<=', now)
        .limit(limit)
        .get();

      const jobs = snapshot.docs.map((doc) => doc.data() as TranscriptionJob);
      return ok(jobs);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to get jobs ready to poll: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getPendingJobs(limit = 10): Promise<Result<TranscriptionJob[], TranscriptionError>> {
    try {
      const db = getFirestore();

      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .get();

      const jobs = snapshot.docs.map((doc) => doc.data() as TranscriptionJob);
      return ok(jobs);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to get pending jobs: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
