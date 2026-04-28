/**
 * Firestore health check helper.
 *
 * Exposes a functional `HealthCheck` probe that callers pass to
 * `registerHealthCheck` from `@intexuraos/http-server`. The `HealthCheck`
 * shape is mirrored locally so this package does not depend on
 * `@intexuraos/http-server` (the dependency direction would be backwards).
 * TypeScript's structural typing guarantees the shape is interchangeable.
 */
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from './firestore.js';

/**
 * Outcome returned by a single probe — mirrors the contract of
 * `@intexuraos/http-server`'s `HealthCheck.check()`.
 */
export type HealthCheckOutcome = { ok: true } | { ok: false; detail?: string };

/**
 * Functional health-check probe — mirrors the `HealthCheck` interface
 * from `@intexuraos/http-server`.
 */
export interface HealthCheck {
  name: string;
  check: () => Promise<HealthCheckOutcome>;
}

/**
 * How long to wait before declaring the Firestore probe down (ms).
 * Picked to fit comfortably inside Cloud Run's startup probe budget
 * while still producing a usable signal on slow networks.
 */
const FIRESTORE_HEALTH_TIMEOUT_MS = 3000;

/**
 * Build a Firestore connectivity probe.
 *
 * The probe is automatically a no-op in test environments
 * (`NODE_ENV=test` or `VITEST` set) so unit/integration tests do not
 * require a live emulator. In production, the probe issues a single
 * lightweight document read with a {@link FIRESTORE_HEALTH_TIMEOUT_MS}
 * timeout — reading a non-existent doc costs one Firestore read (vs.
 * the full-collection scan that `listCollections()` would trigger).
 */
export function firestoreHealthCheck(): HealthCheck {
  return {
    name: 'firestore',
    check: async (): Promise<HealthCheckOutcome> => {
      if (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] !== undefined) {
        return { ok: true };
      }

      try {
        const db = getFirestore();
        // 💰 CostGuard: lightweight doc read instead of listCollections()
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout((): void => {
            reject(new Error('Firestore health check timed out'));
          }, FIRESTORE_HEALTH_TIMEOUT_MS);
        });

        await Promise.race([db.collection('_health_check').doc('ping').get(), timeoutPromise]);
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: getErrorMessage(error) };
      }
    },
  };
}
