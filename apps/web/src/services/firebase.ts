/**
 * Firebase SDK initialization with cost optimizations.
 *
 * Key cost optimization features:
 * - 💰 CostGuard: IndexedDB persistence to cache data locally
 * - 💰 CostGuard: Lazy initialization to reduce startup reads
 * - 💰 CostGuard: Auth0-to-Firebase token exchange for secure access
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import { getAuth, signInWithCustomToken, signOut, connectAuthEmulator, type Auth } from 'firebase/auth';
import { config } from '@/config';

let firebaseApp: FirebaseApp | null = null;
let firestoreClient: Firestore | null = null;
let firebaseAuth: Auth | null = null;
let isInitialized = false;

/**
 * Initialize Firebase SDK with cost-optimized settings.
 * Call this once at app startup.
 */
export function initializeFirebase(): void {
  if (isInitialized) return;

  const existingApps = getApps();
  if (existingApps.length > 0 && existingApps[0] !== undefined) {
    firebaseApp = existingApps[0];
  } else {
    firebaseApp = initializeApp({
      projectId: config.firebaseProjectId,
      apiKey: config.firebaseApiKey,
      authDomain: config.firebaseAuthDomain,
    });
  }

  // 💰 CostGuard: Enable offline persistence with IndexedDB
  // This caches Firestore data locally, reducing server reads on page refresh
  firestoreClient = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });

  firebaseAuth = getAuth(firebaseApp);

  // Connect to emulators when running on localhost
  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isLocalhost) {
    connectFirestoreEmulator(firestoreClient, 'localhost', 8101);
    connectAuthEmulator(firebaseAuth, 'http://localhost:8104', { disableWarnings: true });
  }

  isInitialized = true;
}

/**
 * Get the Firestore client instance.
 * @throws Error if Firebase is not initialized
 */
export function getFirestoreClient(): Firestore {
  if (firestoreClient === null) {
    if (!isInitialized) {
      initializeFirebase();
    }
    firestoreClient = getFirestore(firebaseApp as FirebaseApp);
  }
  return firestoreClient;
}

/**
 * Get the Firebase Auth instance.
 * @throws Error if Firebase is not initialized
 */
export function getFirebaseAuth(): Auth {
  if (firebaseAuth === null) {
    if (!isInitialized) {
      initializeFirebase();
    }
    firebaseAuth = getAuth(firebaseApp as FirebaseApp);
  }
  return firebaseAuth;
}

/**
 * Authenticate with Firebase using Auth0 token.
 * Exchanges Auth0 JWT for Firebase custom token and signs in.
 *
 * @param auth0Token - Valid Auth0 access token
 */
export async function authenticateFirebase(auth0Token: string): Promise<void> {
  const auth = getFirebaseAuth();

  // Exchange Auth0 token for Firebase custom token via backend
  const response = await fetch(`${config.authServiceUrl}/auth/firebase-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth0Token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get Firebase custom token');
  }

  interface FirebaseTokenResponse {
    success: boolean;
    data: { customToken: string };
  }

  const result = (await response.json()) as FirebaseTokenResponse;
  await signInWithCustomToken(auth, result.data.customToken);
}

/**
 * Sign out from Firebase.
 */
export async function signOutFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  await signOut(auth);
}

/**
 * Check if Firebase is initialized and user is authenticated.
 */
export function isFirebaseAuthenticated(): boolean {
  if (!isInitialized || firebaseAuth === null) {
    return false;
  }
  return firebaseAuth.currentUser !== null;
}

/**
 * Reset Firebase state (for testing).
 */
export function resetFirebaseState(): void {
  firebaseApp = null;
  firestoreClient = null;
  firebaseAuth = null;
  isInitialized = false;
}
