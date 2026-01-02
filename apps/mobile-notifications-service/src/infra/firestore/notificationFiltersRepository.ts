/**
 * Firestore implementation of NotificationFiltersRepository.
 * Stores filter options and saved filters per user.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { FieldValue, getFirestore } from '@intexuraos/infra-firestore';
import type {
  CreateSavedFilterInput,
  FilterOptionField,
  FiltersRepositoryError,
  NotificationFiltersData,
  NotificationFiltersRepository,
  SavedNotificationFilter,
} from '../../domain/filters/index.js';

const COLLECTION_NAME = 'mobile_notifications_filters';

/**
 * Document structure in Firestore.
 */
interface FiltersDoc {
  options: {
    app: string[];
    device: string[];
    source: string[];
  };
  savedFilters: {
    id: string;
    name: string;
    app?: string;
    device?: string;
    source?: string;
    title?: string;
    createdAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Create default empty document structure.
 */
function createEmptyDoc(): FiltersDoc {
  const now = new Date().toISOString();
  return {
    options: { app: [], device: [], source: [] },
    savedFilters: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Firestore-backed notification filters repository.
 */
export class FirestoreNotificationFiltersRepository implements NotificationFiltersRepository {
  async getByUserId(
    userId: string
  ): Promise<Result<NotificationFiltersData | null, FiltersRepositoryError>> {
    try {
      const db = getFirestore();
      const docSnap = await db.collection(COLLECTION_NAME).doc(userId).get();

      if (!docSnap.exists) {
        return ok(null);
      }

      const data = docSnap.data() as Partial<FiltersDoc>;
      return ok({
        userId,
        options: {
          app: data.options?.app ?? [],
          device: data.options?.device ?? [],
          source: data.options?.source ?? [],
        },
        savedFilters: data.savedFilters ?? [],
        createdAt: data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to get notification filters'),
      });
    }
  }

  async addOption(
    userId: string,
    field: FilterOptionField,
    value: string
  ): Promise<Result<void, FiltersRepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const now = new Date().toISOString();

      await docRef.set(
        {
          options: { [field]: FieldValue.arrayUnion(value) },
          updatedAt: now,
        },
        { merge: true }
      );

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to add filter option'),
      });
    }
  }

  async addOptions(
    userId: string,
    options: Partial<Record<FilterOptionField, string>>
  ): Promise<Result<void, FiltersRepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const now = new Date().toISOString();

      const optionsData: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(options)) {
        optionsData[field] = FieldValue.arrayUnion(value);
      }

      await docRef.set({ options: optionsData, updatedAt: now }, { merge: true });
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to add filter options'),
      });
    }
  }

  async addSavedFilter(
    userId: string,
    filter: CreateSavedFilterInput
  ): Promise<Result<SavedNotificationFilter, FiltersRepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);

      const savedFilter: SavedNotificationFilter = {
        id: crypto.randomUUID(),
        name: filter.name,
        createdAt: new Date().toISOString(),
      };

      if (filter.app !== undefined) savedFilter.app = filter.app;
      if (filter.device !== undefined) savedFilter.device = filter.device;
      if (filter.source !== undefined) savedFilter.source = filter.source;
      if (filter.title !== undefined) savedFilter.title = filter.title;

      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        const newDoc = createEmptyDoc();
        newDoc.savedFilters.push(savedFilter);
        await docRef.set(newDoc);
      } else {
        await docRef.update({
          savedFilters: FieldValue.arrayUnion(savedFilter),
          updatedAt: new Date().toISOString(),
        });
      }

      return ok(savedFilter);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to add saved filter'),
      });
    }
  }

  async deleteSavedFilter(
    userId: string,
    filterId: string
  ): Promise<Result<void, FiltersRepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);

      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        return err({
          code: 'NOT_FOUND',
          message: 'Filter data not found for user',
        });
      }

      const data = docSnap.data() as Partial<FiltersDoc>;
      const savedFilters = data.savedFilters ?? [];
      const updatedFilters = savedFilters.filter((f) => f.id !== filterId);

      if (updatedFilters.length === savedFilters.length) {
        return err({
          code: 'NOT_FOUND',
          message: 'Saved filter not found',
        });
      }

      await docRef.update({
        savedFilters: updatedFilters,
        updatedAt: new Date().toISOString(),
      });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to delete saved filter'),
      });
    }
  }
}
