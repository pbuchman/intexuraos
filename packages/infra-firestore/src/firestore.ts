/**
 * Firestore client singleton.
 * Provides initialized Firestore instance for all services.
 */
import { Firestore, FieldValue } from '@google-cloud/firestore';

// Re-export FieldValue for use in repositories (e.g., FieldValue.delete())
export { FieldValue };

let firestoreInstance: Firestore | null = null;

/**
 * Get or create the Firestore client instance.
 * Uses application default credentials in production.
 * In development, uses FIRESTORE_EMULATOR_HOST with demo project.
 */
export function getFirestore(): Firestore {
  if (firestoreInstance === null) {
    const projectId = process.env['GOOGLE_CLOUD_PROJECT'];

    if (projectId === undefined) {
      throw new Error('Missing GOOGLE_CLOUD_PROJECT environment variable. Run: direnv allow');
    }

    firestoreInstance = new Firestore({ projectId });
  }
  return firestoreInstance;
}

/**
 * Reset the Firestore instance (for testing).
 */
export function resetFirestore(): void {
  firestoreInstance = null;
}

/**
 * Set a custom Firestore instance (for testing).
 */
export function setFirestore(instance: Firestore): void {
  firestoreInstance = instance;
}
