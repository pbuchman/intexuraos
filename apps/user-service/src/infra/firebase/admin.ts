/**
 * Firebase Admin SDK initialization.
 * Uses Application Default Credentials for authentication.
 */

import { initializeApp, getApps, type App } from 'firebase-admin/app';

let firebaseApp: App | null = null;

/**
 * Get or initialize the Firebase Admin app.
 * Uses Application Default Credentials (ADC) for authentication.
 * In GCP environments (Cloud Run), ADC is automatically available.
 */
export function getFirebaseAdmin(): App {
  if (firebaseApp !== null) {
    return firebaseApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0 && existingApps[0] !== undefined) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }

  const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
  if (projectId === undefined || projectId === '') {
    throw new Error('Missing INTEXURAOS_GCP_PROJECT_ID environment variable');
  }

  firebaseApp = initializeApp({ projectId });
  return firebaseApp;
}

/**
 * Reset the Firebase Admin app (for testing).
 */
export function resetFirebaseAdmin(): void {
  firebaseApp = null;
}
