/**
 * Firestore client singleton.
 * Provides initialized Firestore instance for all services.
 */
import { Firestore } from '@google-cloud/firestore';

let firestoreInstance: Firestore | null = null;

/**
 * Get or create the Firestore client instance.
 * Uses application default credentials in production.
 */
export function getFirestore(): Firestore {
  firestoreInstance ??= new Firestore({
    // Uses GOOGLE_APPLICATION_CREDENTIALS or GCP metadata service
    // Project ID is inferred from environment
  });
  return firestoreInstance;
}

/**
 * Reset the Firestore instance (for testing).
 */
export function resetFirestore(): void {
  firestoreInstance = null;
}

/**
 * Set a custom Firestore instance (for testing with emulator).
 */
export function setFirestore(instance: Firestore): void {
  firestoreInstance = instance;
}
