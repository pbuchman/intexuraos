/**
 * Firestore client singleton.
 * Provides initialized Firestore instance for all services.
 */
import { FieldValue, Firestore } from '@google-cloud/firestore';

// Re-export FieldValue for use in repositories (e.g., FieldValue.delete())
export { FieldValue };

// Re-export Firestore type for type annotations
export type { Firestore };

let firestoreInstance: Firestore | null = null;

/**
 * Get or create the Firestore client instance.
 * Uses application default credentials in production.
 * In development, uses FIRESTORE_EMULATOR_HOST with demo project.
 */
export function getFirestore(): Firestore {
  if (firestoreInstance === null) {
    const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];

    if (projectId === undefined) {
      throw new Error('Missing INTEXURAOS_GCP_PROJECT_ID environment variable. Run: direnv allow');
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
