/**
 * Passive health check for the Notion SDK.
 *
 * Notion connections are per-user (each user provides their own integration
 * token), so the service cannot actively probe Notion connectivity at
 * startup. We instead report a structured "passive" outcome that explains
 * why the check is informational only — per-request validation happens
 * inside the routes that proxy Notion API calls.
 *
 * The shape returned here is a {@link HealthCheck} probe: callers pass it
 * directly to `registerHealthCheck` from `@intexuraos/http-server`. We
 * import the type from there to ensure it stays in sync with the contract.
 */
import type { HealthCheck } from '@intexuraos/http-server';

/**
 * Passive Notion SDK probe.
 *
 * Always returns `{ ok: true }`: the SDK ships in this service's bundle,
 * so its mere presence is the strongest signal we can offer without a
 * per-user credential. The probe exists primarily to document the
 * passive-validation contract in the `/health` payload.
 */
export function notionSdkHealthCheck(): HealthCheck {
  return {
    name: 'notion-sdk',
    check: () => Promise.resolve({ ok: true }),
  };
}
