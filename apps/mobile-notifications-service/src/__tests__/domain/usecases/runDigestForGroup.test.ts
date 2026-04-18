import { describe, expect, it, afterEach, vi } from 'vitest';
import { runDigestForGroup } from '../../../domain/usecases/runDigestForGroup.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';
import { setMockServices } from '../../helpers/mockServices.js';
import { resetServices } from '../../../services.js';
import { FakeLlmClient } from '../../helpers/fakeLlmClient.js';
import type { NotificationRepository } from '../../../domain/notifications/index.js';
import type { DailySummary } from '../../../domain/schemas/digestSchemas.js';
import type { GenerateOptions, GenerateResult, LLMError } from '@intexuraos/llm-factory';
import type { Result } from '@intexuraos/common-core';

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// COLD_START_EXAMPLE uses readonly tuple literals; cast to mutable types for use in fakes
const EXAMPLE_SUMMARY = COLD_START_EXAMPLE.dailySummary as unknown as DailySummary;

function fakeNotificationRepo(messages: readonly { sender: string; text: string; postTime: string; title: string; app: string }[]): NotificationRepository {
  return {
    findByUserIdPaginated: async () => ({
      ok: true as const,
      value: {
        notifications: messages.map((m, i) => ({
          id: `n${i}`, userId: 'u', source: 's', device: 'd',
          notificationId: `n${i}`, timestamp: 0, receivedAt: '',
          ...m,
        })),
      },
    }),
    save: async () => ({ ok: true as const, value: { id: 'x', userId: 'u', source: 's', device: 'd', app: 'a', title: 't', text: '', timestamp: 0, postTime: '', notificationId: 'n', receivedAt: '' } }),
    findById: async () => ({ ok: true as const, value: null }),
    existsByNotificationIdAndUserId: async () => ({ ok: true as const, value: false }),
    delete: async () => ({ ok: true as const, value: undefined }),
  };
}

describe('runDigestForGroup', () => {
  afterEach(() => resetServices());

  it('returns lock-held without calling LLM when lock is held by another holder', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true as const, value: { acquired: false, heldBy: 'cron' } }),
        release: async () => ({ ok: true as const, value: undefined }),
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true as const, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'or:google/gemini-3-flash-preview' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('lock-held');
    expect(llm.calls).toHaveLength(0);
  });

  it('happy path: persists summary + state, releases lock, returns generation 1', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    let savedSummary = false;
    let savedState = false;
    let lockReleased = false;
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: true } }),
        release: async () => { lockReleased = true; return { ok: true, value: undefined }; },
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => { savedSummary = true; return { ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }; },
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => { savedState = true; return { ok: true, value: undefined }; },
      },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'or:google/gemini-3-flash-preview' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generation).toBe(1);
    expect(savedSummary).toBe(true);
    expect(savedState).toBe(true);
    expect(lockReleased).toBe(true);
  });

  it('passes the date verbatim into aggregateDigest input (no in-flow CET conversion)', async () => {
    // runDigestForGroup is timezone-agnostic: callers (cron route + manual triggers) compute
    // the CET date and pass it as `input.date`. This test asserts the use case does NOT
    // re-derive or shift the date — it forwards it exactly to aggregateDigest's prompt input.
    // The CET-yesterday computation is owned by `yesterdayCet()` (tested in Task 3.1).
    let capturedPromptDate: string | null = null;
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    // Wrap llm.generate to capture the date as it appears in the prompt
    const originalGenerate = llm.generate.bind(llm);
    llm.generate = async (prompt: string, options?: GenerateOptions): Promise<Result<GenerateResult, LLMError>> => {
      const match = /^date: (\d{4}-\d{2}-\d{2})/m.exec(prompt);
      capturedPromptDate = match?.[1] ?? null;
      return originalGenerate(prompt, options);
    };
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(capturedPromptDate).toBe('2026-04-15');
  });

  it('returns persistence-failed when lock acquire returns err', async () => {
    const llm = new FakeLlmClient([]);
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: 'Firestore unavailable' } }),
        release: async () => ({ ok: true as const, value: undefined }),
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('persistence-failed');
  });

  it('returns lock-held with unknown heldBy when heldBy is absent', async () => {
    const llm = new FakeLlmClient([]);
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true as const, value: { acquired: false } }), // no heldBy
        release: async () => ({ ok: true as const, value: undefined }),
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('lock-held');
  });

  it('returns persistence-failed when loadPreviousState fails', async () => {
    const llm = new FakeLlmClient([]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: {
        getByDate: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: 'DB error' } }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: undefined }),
      },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('persistence-failed');
  });

  it('returns persistence-failed when loadLastSummaries fails', async () => {
    const llm = new FakeLlmClient([]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: 'DB error' } }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('persistence-failed');
  });

  it('returns persistence-failed when loadDayMessages fails', async () => {
    const llm = new FakeLlmClient([]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: {
        ...fakeNotificationRepo([]),
        findByUserIdPaginated: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: 'DB error' } }),
      },
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('persistence-failed');
  });

  it('returns aggregation error when LLM fails', async () => {
    const llm = new FakeLlmClient([{ type: 'error', value: 'LLM unavailable' }]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('llm-call-failed');
  });

  it('returns persistence-failed when digest save fails', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: 'write failed' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('persistence-failed');
  });

  it('returns persistence-failed when group state save fails', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: 'write failed' } }),
      },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('persistence-failed');
  });

  it('filters notifications by groupTitlePrefix, not groupKey slug', async () => {
    // Stored WhatsApp notifications have human-readable titles like
    // "Grupa Wędkarska Skool (5 messages): ~ Zuza". The groupKey is the slug
    // (dashes, stripped diacritics) and does not appear in stored titles.
    // The digest must filter by the subscription's groupTitlePrefix.
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    let capturedTitleFilter: string | undefined;
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: {
        ...fakeNotificationRepo([]),
        findByUserIdPaginated: async (_userId, opts) => {
          capturedTitleFilter = opts?.filter?.title;
          return { ok: true as const, value: { notifications: [] } };
        },
      },
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'grupa-wedkarska-skool', groupTitlePrefix: 'Grupa Wędkarska Skool', date: '2026-04-15', holder: 'manual' },
    );
    expect(capturedTitleFilter).toBe('Grupa Wędkarska Skool');
  });

  it('passes CET day bounds to notification repo based on input.date', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    let capturedFrom: number | undefined;
    let capturedTo: number | undefined;
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: {
        ...fakeNotificationRepo([]),
        findByUserIdPaginated: async (_userId, opts) => {
          capturedFrom = opts?.filter?.postTimeSecFrom;
          capturedTo = opts?.filter?.postTimeSecTo;
          return { ok: true as const, value: { notifications: [] } };
        },
      },
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });

    await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'grupa-wedkarska-skool', groupTitlePrefix: 'Grupa Wędkarska Skool', date: '2026-04-17', holder: 'manual' },
    );

    // 2026-04-17 CEST (UTC+2): from = 2026-04-16T22:00:00Z .. to = 2026-04-17T22:00:00Z
    expect(capturedFrom).toBeDefined();
    expect(capturedTo).toBeDefined();
    expect(new Date((capturedFrom ?? 0) * 1000).toISOString()).toBe('2026-04-16T22:00:00.000Z');
    expect(new Date((capturedTo ?? 0) * 1000).toISOString()).toBe('2026-04-17T22:00:00.000Z');
  });

  it('regenerated is true when digest already exists for the date', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 2, generatedAt: '', modelId: '' } }),
        findByDate: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'cron' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.regenerated).toBe(true);
    expect(result.value.generation).toBe(2);
  });

  it('publishes a WhatsApp digest-ready notification after successful save', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    const sent: unknown[] = [];
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: true } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: undefined }),
      },
      digestNotifier: {
        sendDigestReady: async (input) => { sent.push(input); return { ok: true as const, value: undefined }; },
      },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    const call = sent[0] as { userId: string; groupKey: string; date: string; headline: string; bullets: readonly string[]; messageCount: number };
    expect(call.userId).toBe('u');
    expect(call.groupKey).toBe('g');
    expect(call.date).toBe('2026-04-15');
    expect(call.headline).toBe(EXAMPLE_SUMMARY.headline);
    expect(call.bullets).toEqual(EXAMPLE_SUMMARY.bullets);
    expect(call.messageCount).toBe(EXAMPLE_SUMMARY.messageCount);
  });

  it('does NOT notify when the lock is held', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    const notifier = { sendDigestReady: vi.fn(async () => ({ ok: true as const, value: undefined })) };
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: false, heldBy: 'cron' } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
      digestNotifier: notifier,
    });
    await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(notifier.sendDigestReady).not.toHaveBeenCalled();
  });

  it('does NOT notify when digestRepository.save fails', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    const notifier = { sendDigestReady: vi.fn(async () => ({ ok: true as const, value: undefined })) };
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR', message: 'boom' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
      digestNotifier: notifier,
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(false);
    expect(notifier.sendDigestReady).not.toHaveBeenCalled();
  });

  it('still returns ok(...) when the digest notifier fails', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
      digestNotifier: {
        sendDigestReady: async () => ({ ok: false as const, error: { code: 'notification_failed', message: 'pubsub down' } }),
      },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(true);
  });
});
