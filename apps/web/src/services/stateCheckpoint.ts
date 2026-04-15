/**
 * State checkpoint service for PWA resilience.
 * Persists app state to IndexedDB so it can survive process kills
 * (e.g., Android HyperOS killing the PWA after ~2 min of inactivity).
 */

const DB_NAME = 'intexuraos-state';
const STORE_NAME = 'checkpoint';
const DB_VERSION = 1;
const RECORD_KEY = 'current';
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export interface StateCheckpoint {
  routePath: string;
  scrollY: number;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (): void => {
      resolve(request.result);
    };

    request.onerror = (): void => {
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });
}

export async function saveCheckpoint(state: StateCheckpoint): Promise<void> {
  try {
    const db = await openDB();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(state, RECORD_KEY);

        request.onsuccess = (): void => {
          if (typeof tx.commit === 'function') {
            tx.commit();
          }
          resolve();
        };

        request.onerror = (): void => {
          reject(request.error ?? new Error('Failed to save checkpoint'));
        };
      });
    } finally {
      db.close();
    }
  } catch {
    // Silently fail — checkpoint is best-effort
  }
}

export async function loadCheckpoint(): Promise<StateCheckpoint | null> {
  try {
    const db = await openDB();
    try {
      const result = await new Promise<StateCheckpoint | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(RECORD_KEY);

        request.onsuccess = (): void => {
          const data = request.result as StateCheckpoint | undefined;
          if (data === undefined) {
            resolve(null);
            return;
          }

          // Check staleness
          const age = Date.now() - data.timestamp;
          if (age > STALE_THRESHOLD_MS) {
            resolve(null);
            return;
          }

          resolve(data);
        };

        request.onerror = (): void => {
          reject(request.error ?? new Error('Failed to load checkpoint'));
        };
      });
      return result;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function clearCheckpoint(): Promise<void> {
  try {
    const db = await openDB();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(RECORD_KEY);

        request.onsuccess = (): void => {
          if (typeof tx.commit === 'function') {
            tx.commit();
          }
          resolve();
        };

        request.onerror = (): void => {
          reject(request.error ?? new Error('Failed to clear checkpoint'));
        };
      });
    } finally {
      db.close();
    }
  } catch {
    // Silently fail — checkpoint is best-effort
  }
}
