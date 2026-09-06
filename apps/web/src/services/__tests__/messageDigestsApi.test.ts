import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../apiClient.js';
import {
  confirmMessageDigestRun,
  createMessageDigest,
  deleteMessageDigest,
  getMessageDigest,
  getMessageDigestDeliveryReadiness,
  getMessageDigestErasure,
  getMessageDigestRun,
  listMessageDigestRuns,
  listMessageDigests,
  prepareMessageDigestRun,
  previewMessageDigest,
  previewMessageDigestSchedule,
  retryMessageDigestRun,
  resumeMessageDigestErasure,
  resolveLegacyMessageDigestRun,
  updateMessageDigest,
} from '../messageDigestsApi.js';
import type {
  CreateMessageDigestInput,
  MessageDigestInstructions,
  MessageDigestSchedule,
} from '@/types/messageDigests';

vi.mock('../apiClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apiClient.js')>();
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock('@/config', () => ({
  config: { messageDigestServiceUrl: 'https://message-digests.test' },
}));

const TOKEN = 'test-access-token';
const SCHEDULE: MessageDigestSchedule = {
  kind: 'daily',
  localTime: '07:30',
  timeZone: 'Europe/Warsaw',
};
const INSTRUCTIONS: MessageDigestInstructions = {
  templateId: 'fishing_group',
  text: 'Summarize decisions, plans, catches, and concrete follow-up actions.',
};
const CREATE_INPUT: CreateMessageDigestInput = {
  status: 'active',
  name: 'Morning summary',
  source: { chatId: 'chat /+?' },
  instructions: INSTRUCTIONS,
  schedule: SCHEDULE,
};

describe('messageDigestsApi', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({});
  });

  it('builds the exact definition list cursor and sort fingerprint grammar', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const signal = new AbortController().signal;
    vi.mocked(apiRequest).mockResolvedValue({ items: [], nextCursor: 'next' });

    await listMessageDigests(
      TOKEN,
      {
        cursor: 'opaque cursor/+',
        limit: 17,
        query: 'Fishing & friends',
        chatType: 'group',
        status: 'needs_attention',
        sort: 'name',
        direction: 'asc',
      },
      { signal }
    );

    expect(apiRequest).toHaveBeenCalledWith(
      'https://message-digests.test',
      '/?cursor=opaque+cursor%2F%2B&limit=17&query=Fishing+%26+friends&chatType=group&status=needs_attention&sort=name&direction=asc',
      TOKEN,
      { signal }
    );
  });

  it('builds the exact run-history filters and encodes the definition ID', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ items: [], nextCursor: null });

    await listMessageDigestRuns(TOKEN, 'definition /+?', {
      cursor: 'history /+',
      limit: 9,
      fromDate: '2026-07-01',
      toDate: '2026-07-27',
      generationStatus: 'completed',
      deliveryStatus: 'sent',
      sort: 'windowStart',
      direction: 'desc',
    });

    expect(apiRequest).toHaveBeenCalledWith(
      'https://message-digests.test',
      '/definition%20%2F%2B%3F/runs?cursor=history+%2F%2B&limit=9&fromDate=2026-07-01&toDate=2026-07-27&generationStatus=completed&deliveryStatus=sent&sort=windowStart&direction=desc',
      TOKEN
    );
  });

  it('resolves a legacy alias only through the new Message Digest service', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const signal = new AbortController().signal;
    vi.mocked(apiRequest).mockResolvedValue({
      definitionId: 'md_canonical_001',
      runId: 'mdr_canonical_001',
    });

    await expect(
      resolveLegacyMessageDigestRun(
        TOKEN,
        'group key/+?',
        '2026-07-27',
        { signal }
      )
    ).resolves.toEqual({
      definitionId: 'md_canonical_001',
      runId: 'mdr_canonical_001',
    });
    expect(apiRequest).toHaveBeenCalledWith(
      'https://message-digests.test',
      '/legacy-runs/group%20key%2F%2B%3F/2026-07-27',
      TOKEN,
      { signal }
    );
  });

  it('creates with the caller-owned stable request ID and no recipient field', async () => {
    const { apiRequest } = await import('../apiClient.js');
    await createMessageDigest(TOKEN, CREATE_INPUT, 'create-request-001');

    expect(apiRequest).toHaveBeenCalledWith(
      'https://message-digests.test',
      '/',
      TOKEN,
      {
        method: 'POST',
        body: CREATE_INPUT,
        headers: { 'Idempotency-Key': 'create-request-001' },
      }
    );
    expect(JSON.stringify(vi.mocked(apiRequest).mock.calls[0])).not.toMatch(
      /recipient|phoneNumber|sourceAccountId|generationId|userId/u
    );
  });

  it('gets an encoded definition and applies a revision-CAS patch', async () => {
    const { apiRequest } = await import('../apiClient.js');
    await getMessageDigest(TOKEN, 'definition /+?');
    await updateMessageDigest(TOKEN, 'definition /+?', {
      expectedRevision: 7,
      patch: { name: 'Renamed digest', status: 'paused' },
    });

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://message-digests.test',
      '/definition%20%2F%2B%3F',
      TOKEN
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://message-digests.test',
      '/definition%20%2F%2B%3F',
      TOKEN,
      {
        method: 'PATCH',
        body: {
          expectedRevision: 7,
          patch: { name: 'Renamed digest', status: 'paused' },
        },
      }
    );
  });

  it('reads delivery readiness and previews the backend-owned schedule calculation', async () => {
    const { apiRequest } = await import('../apiClient.js');
    await getMessageDigestDeliveryReadiness(TOKEN);
    await previewMessageDigestSchedule(TOKEN, {
      schedule: SCHEDULE,
      evaluatedAt: '2026-07-27T12:00:00.000Z',
    });

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://message-digests.test',
      '/delivery-readiness',
      TOKEN
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://message-digests.test',
      '/schedule-preview',
      TOKEN,
      {
        method: 'POST',
        body: { schedule: SCHEDULE, evaluatedAt: '2026-07-27T12:00:00.000Z' },
      }
    );
  });

  it('forwards weekdays and weekly schedules without client-side calendar calculation', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const weekdays: MessageDigestSchedule = {
      kind: 'weekdays',
      localTime: '08:00',
      timeZone: 'Europe/Warsaw',
    };
    const weekly: MessageDigestSchedule = {
      kind: 'weekly',
      weekday: 'saturday',
      localTime: '09:15',
      timeZone: 'Europe/Warsaw',
    };

    await previewMessageDigestSchedule(TOKEN, { schedule: weekdays });
    await previewMessageDigestSchedule(TOKEN, { schedule: weekly });

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://message-digests.test',
      '/schedule-preview',
      TOKEN,
      { method: 'POST', body: { schedule: weekdays } }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://message-digests.test',
      '/schedule-preview',
      TOKEN,
      { method: 'POST', body: { schedule: weekly } }
    );
  });

  it('uses revision-CAS patches for pause and resume independently', async () => {
    const { apiRequest } = await import('../apiClient.js');
    await updateMessageDigest(TOKEN, 'definition-a', {
      expectedRevision: 4,
      patch: { status: 'paused' },
    });
    await updateMessageDigest(TOKEN, 'definition-a', {
      expectedRevision: 5,
      patch: { status: 'active' },
    });

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://message-digests.test',
      '/definition-a',
      TOKEN,
      { method: 'PATCH', body: { expectedRevision: 4, patch: { status: 'paused' } } }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://message-digests.test',
      '/definition-a',
      TOKEN,
      { method: 'PATCH', body: { expectedRevision: 5, patch: { status: 'active' } } }
    );
  });

  it('previews content without adding persistence or delivery parameters', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const previewInput = {
      source: CREATE_INPUT.source,
      instructions: INSTRUCTIONS,
      schedule: SCHEDULE,
    };

    await previewMessageDigest(TOKEN, previewInput);

    expect(apiRequest).toHaveBeenCalledWith(
      'https://message-digests.test',
      '/preview',
      TOKEN,
      { method: 'POST', body: previewInput, timeout: 90_000 }
    );
  });

  it('prepares the exact run window and confirms it with one request ID and token', async () => {
    const { apiRequest } = await import('../apiClient.js');
    await prepareMessageDigestRun(TOKEN, 'definition /+?');
    await confirmMessageDigestRun(
      TOKEN,
      'definition /+?',
      'short-lived-preparation-token',
      'manual-request-001'
    );

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://message-digests.test',
      '/definition%20%2F%2B%3F/run/prepare',
      TOKEN,
      { method: 'POST' }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://message-digests.test',
      '/definition%20%2F%2B%3F/run',
      TOKEN,
      {
        method: 'POST',
        body: { preparationToken: 'short-lived-preparation-token' },
        headers: { 'Idempotency-Key': 'manual-request-001' },
      }
    );
  });

  it('gets an exact run detail with both opaque path segments encoded', async () => {
    const { apiRequest } = await import('../apiClient.js');
    await getMessageDigestRun(TOKEN, 'definition /+?', 'run /+?');

    expect(apiRequest).toHaveBeenCalledWith(
      'https://message-digests.test',
      '/definition%20%2F%2B%3F/runs/run%20%2F%2B%3F',
      TOKEN
    );
  });

  it('retries the same encoded run with the caller-owned stable request ID', async () => {
    const { apiRequest } = await import('../apiClient.js');
    await retryMessageDigestRun(
      TOKEN,
      'definition /+?',
      'run /+?',
      'retry-request-001'
    );

    expect(apiRequest).toHaveBeenCalledWith(
      'https://message-digests.test',
      '/definition%20%2F%2B%3F/runs/run%20%2F%2B%3F/retry',
      TOKEN,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'retry-request-001' },
      }
    );
  });

  it('repeats bounded deletion, reads erasure state, and resumes by owner-safe erasure ID', async () => {
    const { apiRequest } = await import('../apiClient.js');
    await deleteMessageDigest(TOKEN, 'definition /+?', 'delete-request-001');
    await deleteMessageDigest(TOKEN, 'definition /+?', 'delete-request-001');
    await getMessageDigestErasure(TOKEN, 'erasure /+?');
    await resumeMessageDigestErasure(TOKEN, 'erasure /+?');

    const deletionOptions = {
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'delete-request-001' },
    };
    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://message-digests.test',
      '/definition%20%2F%2B%3F',
      TOKEN,
      deletionOptions
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://message-digests.test',
      '/definition%20%2F%2B%3F',
      TOKEN,
      deletionOptions
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      3,
      'https://message-digests.test',
      '/erasures/erasure%20%2F%2B%3F',
      TOKEN
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      4,
      'https://message-digests.test',
      '/erasures/erasure%20%2F%2B%3F/resume',
      TOKEN,
      { method: 'POST' }
    );
  });

  it('preserves safe API error envelope details for conflict recovery', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const conflict = new ApiError('CONFLICT', 'Refresh and retry', 409, {
      reason: 'REVISION_CONFLICT',
      refreshRequired: true,
    });
    vi.mocked(apiRequest).mockRejectedValue(conflict);

    await expect(
      updateMessageDigest(TOKEN, 'definition', {
        expectedRevision: 2,
        patch: { name: 'Changed' },
      })
    ).rejects.toBe(conflict);
  });
});
