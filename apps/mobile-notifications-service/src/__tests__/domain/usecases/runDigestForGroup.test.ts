import { describe, expect, it, afterEach, vi } from 'vitest';
import { runDigestForGroup } from '../../../domain/usecases/runDigestForGroup.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';
import { setMockServices } from '../../helpers/mockServices.js';
import { resetServices } from '../../../services.js';
import { FakeLlmClient } from '../../helpers/fakeLlmClient.js';

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakeNotificationRepo(messages: ReadonlyArray<{ sender: string; text: string; postTime: string; title: string; app: string }>) {
  // Minimal in-memory fake matching the existing NotificationRepository interface (subset used here)
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
    save: async () => ({ ok: true as const, value: { id: 'x' } }),
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
      digestRepository: { save: async () => ({ ok: true as const, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'or:google/gemini-3-flash-preview' },
      { userId: 'u', groupKey: 'g', date: '2026-04-15', holder: 'manual' },
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
        save: async () => { savedSummary = true; return { ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: '' } }; },
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
      { userId: 'u', groupKey: 'g', date: '2026-04-15', holder: 'manual' },
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
    llm.generate = async (prompt, options) => {
      const match = /^date: (\d{4}-\d{2}-\d{2})/m.exec(prompt);
      capturedPromptDate = match?.[1] ?? null;
      return originalGenerate(prompt, options);
    };
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', date: '2026-04-15', holder: 'manual' },
    );
    expect(capturedPromptDate).toBe('2026-04-15');
  });
});
