/**
 * Focused smoke tests for the `configRoutes` sub-plugin.
 *
 * Exercises each of the five PATCH `default-*-worker-type` endpoints,
 * verifies the value is persisted, and covers the `"auto"` clear
 * sentinel. Exhaustive error-branch coverage lives in
 * `../workerSettingsRoutes.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { resetFirestore } from '@intexuraos/infra-firestore';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../../server.js';
import { resetServices } from '../../../services.js';
import { setupTestServices } from '../../helpers/mockServices.js';

const CONFIG_ROUTE_FIELDS = [
  { endpoint: 'default-review-worker-type', field: 'defaultReviewWorkerType', value: 'glm' },
  { endpoint: 'default-remediation-worker-type', field: 'defaultRemediationWorkerType', value: 'opus' },
  { endpoint: 'default-execution-worker-type', field: 'defaultExecutionWorkerType', value: 'sonnet' },
  { endpoint: 'default-planning-worker-type', field: 'defaultPlanningWorkerType', value: 'codex' },
  { endpoint: 'default-pull-request-worker-type', field: 'defaultPullRequestWorkerType', value: 'kimi' },
] as const;

describe('configRoutes (sub-plugin)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    setupTestServices();
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    resetFirestore();
  });

  it.each(CONFIG_ROUTE_FIELDS)(
    'persists $field via PATCH /code/worker-settings/$endpoint',
    async ({ endpoint, field, value }) => {
      const patchResponse = await app.inject({
        method: 'PATCH',
        url: `/worker-settings/${endpoint}`,
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        payload: { workerType: value },
      });
      expect(patchResponse.statusCode).toBe(200);
      const patchBody = JSON.parse(patchResponse.body) as { success: boolean; data: { updated: boolean } };
      expect(patchBody.data.updated).toBe(true);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });
      const getBody = JSON.parse(getResponse.body) as {
        success: boolean;
        data: Record<string, unknown>;
      };
      expect(getBody.data[field]).toBe(value);
    }
  );

  it('clears a stored default when "auto" is sent', async () => {
    // First store a concrete value.
    await app.inject({
      method: 'PATCH',
      url: '/worker-settings/default-review-worker-type',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: { workerType: 'glm' },
    });

    // Then clear via the "auto" sentinel.
    const clearResponse = await app.inject({
      method: 'PATCH',
      url: '/worker-settings/default-review-worker-type',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: { workerType: 'auto' },
    });
    expect(clearResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: '/worker-settings',
      headers: { Authorization: 'Bearer test-token' },
    });
    const getBody = JSON.parse(getResponse.body) as {
      success: boolean;
      data: { defaultReviewWorkerType?: string };
    };
    expect(getBody.data.defaultReviewWorkerType).toBeUndefined();
  });

  it('rejects an unknown worker type with 400', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/worker-settings/default-review-worker-type',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: { workerType: 'not-a-real-type' },
    });
    expect(response.statusCode).toBe(400);
  });
});
