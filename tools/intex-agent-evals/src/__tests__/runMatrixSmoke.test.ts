import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  FirebaseAuthError: class MockFirebaseAuthError extends Error {
    readonly code = 'auth/internal-error';
  },
  getAuth: vi.fn(),
}));

import type { MiniMaxMatrixSmokeJudgeResult, MiniMaxJudgeVerdict } from '../minimaxJudge.js';
import type { ValidatedAccountContext } from '../preflight.js';
import type { JudgeUsageSummary } from '../runEndpointScenario.js';
import type { MatrixClient, MatrixTimelineEvent } from '../live/matrixClient.js';
import {
  MATRIX_SMOKE_FAILURE_CODES,
  MATRIX_SMOKE_REPLY_TIMEOUT_MS,
  MATRIX_SYNC_POLL_TIMEOUT_MS,
  buildSafeMatrixSmokePrompt,
  createProductionMatrixSmokeRunner,
  runMatrixSmoke,
  type RunMatrixSmokeDependencies,
} from '../live/runMatrixSmoke.js';

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CONTEXT: ValidatedAccountContext = {
  userId: 'auth0|private-user-sentinel',
  matrixUserId: '@operator-private:home-dev',
  homeserverUrl: 'https://matrix-private.synthetic.test',
  accessToken: 'private-matrix-token-sentinel',
  targetRoomId: '!private-agent-room:home-dev',
};

const USAGE: JudgeUsageSummary = {
  logicalCalls: 1,
  repairCount: 0,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  providerReportedUsd: 0.001,
  providerReportedUsdComplete: true,
};

function passVerdict(): MiniMaxJudgeVerdict {
  return {
    pass: true,
    score: 5,
    criteria: {
      understoodIntent: true,
      helpful: true,
      conciseAndClear: true,
      professionalTone: true,
      noPassiveAggression: true,
    },
    failures: [],
    rationale: 'private judge rationale sentinel',
  };
}

function passJudgeResult(): MiniMaxMatrixSmokeJudgeResult {
  return { ok: true, verdict: passVerdict(), usage: USAGE };
}

interface FakeTimerEntry {
  callback: () => void;
  ms: number;
  cleared: boolean;
}

function createFakeTimer(): {
  timer: RunMatrixSmokeDependencies['timer'];
  entries: FakeTimerEntry[];
  fireActive(ms: number): void;
} {
  const entries: FakeTimerEntry[] = [];
  return {
    entries,
    timer: {
      set: vi.fn((callback, ms) => {
        const entry = { callback, ms, cleared: false };
        entries.push(entry);
        return entry;
      }),
      clear: vi.fn((handle) => {
        const entry = entries.find((candidate) => candidate === handle);
        if (entry !== undefined) {
          entry.cleared = true;
        }
      }),
    },
    fireActive(ms): void {
      const entry = entries.findLast((candidate) => candidate.ms === ms && !candidate.cleared);
      if (entry === undefined) {
        throw new Error(`No active synthetic timer for ${String(ms)}`);
      }
      entry.callback();
    },
  };
}

function eligibleEvent(body = '  Proszę podać treść notatki.  '): MatrixTimelineEvent {
  return {
    type: 'm.room.message',
    sender: '@whatsapp_48123123123:home-dev',
    content: { msgtype: 'm.text', body },
  };
}

function createDependencies(): {
  dependencies: RunMatrixSmokeDependencies;
  fakeTimer: ReturnType<typeof createFakeTimer>;
} {
  const fakeTimer = createFakeTimer();
  const matrix: MatrixClient = {
    whoAmI: vi.fn(async () => ({ ok: true as const, userId: CONTEXT.matrixUserId })),
    syncTargetRoom: vi.fn(async (input) =>
      input.since === undefined
        ? { ok: true as const, nextBatch: 'capture-cursor', limited: false, events: [] }
        : {
            ok: true as const,
            nextBatch: 'reply-cursor',
            limited: false,
            events: [eligibleEvent()],
          }
    ),
  };
  let nowCall = 0;
  const dependencies: RunMatrixSmokeDependencies = {
    withAccountContext: vi.fn(async (callback) => {
      await callback(CONTEXT);
      return { ok: true as const, checks: [] };
    }),
    matrix,
    whatsapp: {
      sendPrivateOutboundMatrixMessage: vi.fn(async () => ({
        ok: true as const,
        value: { status: 'sent' as const, matrixEventId: '$private-outbound-event' },
      })),
    },
    judgeMatrixSmokeReply: vi.fn(async () => passJudgeResult()),
    createUuid: vi.fn(() => UUID),
    nowMs: vi.fn(() => {
      nowCall += 1;
      return nowCall === 1 ? 1_000 : 1_050;
    }),
    timer: fakeTimer.timer,
  };
  return { dependencies, fakeTimer };
}

describe('safe Matrix smoke transport', () => {
  it('exports the locked failure-code tuple and exact timeout constants', () => {
    expect(MATRIX_SMOKE_FAILURE_CODES).toEqual([
      'MATRIX_ACCOUNT_CONTEXT_FAILED',
      'MATRIX_CURSOR_CAPTURE_FAILED',
      'MATRIX_OUTBOUND_NOT_READY',
      'MATRIX_OUTBOUND_SEND_FAILED',
      'MATRIX_SYNC_FAILED',
      'MATRIX_SYNC_INVALID',
      'MATRIX_TIMELINE_LIMITED',
      'MATRIX_REPLY_TIMEOUT',
      'MINIMAX_JUDGE_KEY_MISSING',
      'MINIMAX_JUDGE_TIMEOUT',
      'MINIMAX_JUDGE_PROVIDER_FAILED',
      'MINIMAX_JUDGE_INVALID_OUTPUT',
      'MINIMAX_JUDGE_USAGE_INVALID',
      'MATRIX_UNEXPECTED_FAILURE',
    ]);
    expect(MATRIX_SYNC_POLL_TIMEOUT_MS).toBe(30_000);
    expect(MATRIX_SMOKE_REPLY_TIMEOUT_MS).toBe(120_000);
  });

  it('builds the exact safe Polish prompt and rejects a non-lowercase UUID', () => {
    expect(buildSafeMatrixSmokePrompt(UUID)).toBe(
      `To jest automatyczny test ${UUID}. Rozważam utworzenie notatki, ale celowo nie ` +
        'podaję jej treści i nie zlecam jeszcze zapisu. Odpowiedz wyłącznie prośbą o ' +
        'brakującą treść. Nie zapisuj notatki, nie twórz ani nie zmieniaj kalendarza lub ' +
        'preferencji, nie uruchamiaj researchu ani kodu, nie zapisuj linku ani danych ' +
        'zewnętrznych i nie wykonuj żadnego narzędzia.'
    );
    expect(() => buildSafeMatrixSmokePrompt(UUID.toUpperCase())).toThrow();
  });

  it('rejects an invalid generated UUID before every other dependency call', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.createUuid).mockReturnValue(UUID.toUpperCase());

    const result = await runMatrixSmoke(dependencies);

    expect(result).toEqual({
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: false,
        outboundSent: false,
        eligiblePuppetTextObserved: false,
        hiddenToolAudit: 'not_available',
      },
      judge: { status: 'not_run' },
      durationMs: 0,
    });
    expect(dependencies.nowMs).not.toHaveBeenCalled();
    expect(dependencies.withAccountContext).not.toHaveBeenCalled();
    expect(dependencies.matrix.syncTargetRoom).not.toHaveBeenCalled();
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).not.toHaveBeenCalled();
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it('maps readiness failure without invoking Matrix, WhatsApp, or MiniMax', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.withAccountContext).mockResolvedValue({
      ok: false,
      code: 'CONFIG_INVALID',
      checks: [],
    });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MATRIX_ACCOUNT_CONTEXT_FAILED'],
      judge: { status: 'not_run' },
      transportFacts: {
        cursorCaptured: false,
        outboundSent: false,
        eligiblePuppetTextObserved: false,
        hiddenToolAudit: 'not_available',
      },
    });
    expect(dependencies.matrix.syncTargetRoom).not.toHaveBeenCalled();
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).not.toHaveBeenCalled();
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it('captures the cursor before one exact safe WhatsApp send, then starts the reply deadline', async () => {
    const { dependencies, fakeTimer } = createDependencies();
    const calls: string[] = [];
    vi.mocked(dependencies.matrix.syncTargetRoom).mockImplementation(async (input) => {
      calls.push(input.since === undefined ? 'capture' : 'poll');
      return input.since === undefined
        ? {
            ok: true,
            nextBatch: 'capture-cursor',
            limited: false,
            events: [eligibleEvent('capture history must be ignored')],
          }
        : {
            ok: true,
            nextBatch: 'reply-cursor',
            limited: false,
            events: [eligibleEvent('real reply')],
          };
    });
    vi.mocked(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).mockImplementation(
      async (request) => {
        calls.push('send');
        expect(request).toEqual({
          userId: CONTEXT.userId,
          text: buildSafeMatrixSmokePrompt(UUID),
          startNewSession: true,
          idempotencyKey: `intex-agent-eval-matrix-${UUID}`,
        });
        return {
          ok: true,
          value: { status: 'sent', matrixEventId: '$private-outbound-event' },
        };
      }
    );

    const result = await runMatrixSmoke(dependencies);

    expect(calls).toEqual(['capture', 'send', 'poll']);
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).toHaveBeenCalledTimes(1);
    expect(dependencies.judgeMatrixSmokeReply).toHaveBeenCalledTimes(1);
    expect(dependencies.judgeMatrixSmokeReply).toHaveBeenCalledWith(
      expect.objectContaining({ assistantText: 'real reply' })
    );
    expect(result).toMatchObject({
      effectiveKind: 'passed',
      exitCode: 0,
      failureCodes: [],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
        hiddenToolAudit: 'not_available',
      },
      durationMs: 50,
    });
    expect(vi.mocked(fakeTimer.timer.set).mock.calls.map((call) => call[1])).toEqual([
      MATRIX_SYNC_POLL_TIMEOUT_MS,
      MATRIX_SMOKE_REPLY_TIMEOUT_MS,
    ]);
    expect(fakeTimer.entries.every((entry) => entry.cleared)).toBe(true);
  });

  it('uses exact capture/poll context fields with distinct caller-owned signals', async () => {
    const { dependencies } = createDependencies();

    await runMatrixSmoke(dependencies);

    const captureInput = vi.mocked(dependencies.matrix.syncTargetRoom).mock.calls[0]?.[0];
    const pollInput = vi.mocked(dependencies.matrix.syncTargetRoom).mock.calls[1]?.[0];
    if (captureInput === undefined || pollInput === undefined) {
      throw new Error('Synthetic Matrix calls were not observed');
    }
    expect(captureInput).toEqual({
      homeserverUrl: CONTEXT.homeserverUrl,
      accessToken: CONTEXT.accessToken,
      targetRoomId: CONTEXT.targetRoomId,
      timeoutMs: 0,
      signal: expect.any(AbortSignal),
    });
    expect(Object.hasOwn(captureInput, 'since')).toBe(false);
    expect(pollInput).toEqual({
      homeserverUrl: CONTEXT.homeserverUrl,
      accessToken: CONTEXT.accessToken,
      targetRoomId: CONTEXT.targetRoomId,
      since: 'capture-cursor',
      timeoutMs: 30_000,
      signal: expect.any(AbortSignal),
    });
    expect(captureInput.signal).not.toBe(pollInput.signal);
    expect(captureInput.signal.aborted).toBe(false);
    expect(pollInput.signal.aborted).toBe(false);
  });

  it('lets the 30-second capture abort win over a late success and sends nothing', async () => {
    const { dependencies, fakeTimer } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom).mockImplementation(
      async (input) =>
        await new Promise((resolve) => {
          input.signal.addEventListener('abort', () => {
            resolve({
              ok: true,
              nextBatch: 'late-capture-cursor',
              limited: false,
              events: [],
            });
          });
        })
    );

    const run = runMatrixSmoke(dependencies);
    await vi.waitFor(() => {
      expect(fakeTimer.entries.some((entry) => entry.ms === MATRIX_SYNC_POLL_TIMEOUT_MS)).toBe(
        true
      );
    });
    fakeTimer.fireActive(MATRIX_SYNC_POLL_TIMEOUT_MS);
    const result = await run;

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_CURSOR_CAPTURE_FAILED'],
      transportFacts: { cursorCaptured: false, outboundSent: false },
      judge: { status: 'not_run' },
    });
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).not.toHaveBeenCalled();
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it('does not send when cursor capture returns a closed failure', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom).mockResolvedValue({
      ok: false,
      reason: 'unavailable',
    });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_CURSOR_CAPTURE_FAILED'],
      transportFacts: { cursorCaptured: false, outboundSent: false },
    });
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).not.toHaveBeenCalled();
  });

  it('fails a limited capture timeline before sending', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom).mockResolvedValue({
      ok: true,
      nextBatch: 'limited-capture-cursor',
      limited: true,
      events: [eligibleEvent('capture history')],
    });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_TIMELINE_LIMITED'],
      transportFacts: { cursorCaptured: false, outboundSent: false },
      judge: { status: 'not_run' },
    });
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).not.toHaveBeenCalled();
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it.each([
    [
      { ok: true, value: { status: 'setup_required', reason: 'private setup reason' } },
      'MATRIX_OUTBOUND_NOT_READY',
    ],
    [
      { ok: true, value: { status: 'error', message: 'private send error' } },
      'MATRIX_OUTBOUND_SEND_FAILED',
    ],
    [{ ok: false, error: new Error('private transport error') }, 'MATRIX_OUTBOUND_SEND_FAILED'],
    [{ ok: true, value: { status: 'sent', matrixEventId: '' } }, 'MATRIX_OUTBOUND_SEND_FAILED'],
    [{ ok: true, value: { status: 'sent', matrixEventId: '   ' } }, 'MATRIX_OUTBOUND_SEND_FAILED'],
  ] as const)('strictly maps outbound result to %s', async (sendResult, failureCode) => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).mockResolvedValue(sendResult);

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: [failureCode],
      transportFacts: { cursorCaptured: true, outboundSent: false },
      judge: { status: 'not_run' },
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).toHaveBeenCalledTimes(1);
    expect(dependencies.matrix.syncTargetRoom).toHaveBeenCalledTimes(1);
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it('advances the cursor before inspection and selects only the first eligible puppet text', async () => {
    const { dependencies } = createDependencies();
    const ignoredEvents: MatrixTimelineEvent[] = [
      { type: 'm.reaction', sender: '@whatsapp_48123:home-dev' },
      { type: 'm.room.redaction', sender: '@whatsapp_48123:home-dev' },
      { type: 'm.sticker', sender: '@whatsapp_48123:home-dev' },
      {
        type: 'm.room.message',
        sender: '@whatsapp_48123:home-dev',
        content: { msgtype: 'm.notice', body: 'notice' },
      },
      {
        type: 'm.room.encrypted',
        sender: '@whatsapp_48123:home-dev',
        content: { msgtype: 'm.text', body: 'encrypted' },
      },
      {
        type: 'm.room.message',
        sender: '@whatsapp_48123:home-dev',
        content: { msgtype: 'm.image', body: 'image' },
      },
      {
        type: 'm.room.message',
        sender: '@whatsapp_48123:home-dev',
        content: { msgtype: 'm.text', body: '   ' },
      },
      {
        type: 'm.room.message',
        sender: '@whatsapp_48123:home-dev',
        content: {
          msgtype: 'm.text',
          body: 'edited',
          'm.relates_to': { rel_type: 'm.replace' },
        },
      },
      {
        type: 'm.room.message',
        sender: '@whatsapp_48123:home-dev',
        content: { msgtype: 'm.text', body: 'redacted' },
        unsigned: { redacted_because: true },
      },
      {
        type: 'm.room.message',
        sender: CONTEXT.matrixUserId,
        content: { msgtype: 'm.text', body: 'self' },
      },
      {
        type: 'm.room.message',
        sender: '@bridge_bot:home-dev',
        content: { msgtype: 'm.text', body: 'bridge' },
      },
      {
        type: 'm.room.message',
        sender: '@human:home-dev',
        content: { msgtype: 'm.text', body: 'human non-puppet' },
      },
    ];
    vi.mocked(dependencies.matrix.syncTargetRoom)
      .mockResolvedValueOnce({
        ok: true,
        nextBatch: 'cursor-one',
        limited: false,
        events: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        nextBatch: 'cursor-two',
        limited: false,
        events: ignoredEvents,
      })
      .mockImplementationOnce(async (input) => {
        expect(input.since).toBe('cursor-two');
        return {
          ok: true,
          nextBatch: 'cursor-three',
          limited: false,
          events: [eligibleEvent('  first eligible  '), eligibleEvent('second eligible')],
        };
      });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({ effectiveKind: 'passed', exitCode: 0 });
    expect(dependencies.matrix.syncTargetRoom).toHaveBeenCalledTimes(3);
    expect(dependencies.judgeMatrixSmokeReply).toHaveBeenCalledTimes(1);
    expect(dependencies.judgeMatrixSmokeReply).toHaveBeenCalledWith(
      expect.objectContaining({ assistantText: 'first eligible' })
    );
  });

  it('fails closed on a limited reply timeline', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom)
      .mockResolvedValueOnce({
        ok: true,
        nextBatch: 'capture-cursor',
        limited: false,
        events: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        nextBatch: 'limited-cursor',
        limited: true,
        events: [eligibleEvent()],
      });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_TIMELINE_LIMITED'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: false,
      },
      judge: { status: 'not_run' },
    });
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_response', 'MATRIX_SYNC_INVALID'],
    ['unauthorized', 'MATRIX_SYNC_FAILED'],
    ['unavailable', 'MATRIX_SYNC_FAILED'],
    ['timeout', 'MATRIX_SYNC_FAILED'],
  ] as const)('maps reply sync %s to %s', async (reason, failureCode) => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom)
      .mockResolvedValueOnce({
        ok: true,
        nextBatch: 'capture-cursor',
        limited: false,
        events: [],
      })
      .mockResolvedValueOnce({ ok: false, reason });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: [failureCode],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: false,
      },
    });
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it('lets the overall reply abort win over a late eligible success', async () => {
    const { dependencies, fakeTimer } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom)
      .mockResolvedValueOnce({
        ok: true,
        nextBatch: 'capture-cursor',
        limited: false,
        events: [],
      })
      .mockImplementationOnce(
        async (input) =>
          await new Promise((resolve) => {
            input.signal.addEventListener('abort', () => {
              resolve({
                ok: true,
                nextBatch: 'late-reply-cursor',
                limited: false,
                events: [eligibleEvent('late eligible private sentinel')],
              });
            });
          })
      );

    const run = runMatrixSmoke(dependencies);
    await vi.waitFor(() => {
      expect(fakeTimer.entries.some((entry) => entry.ms === MATRIX_SMOKE_REPLY_TIMEOUT_MS)).toBe(
        true
      );
    });
    fakeTimer.fireActive(MATRIX_SMOKE_REPLY_TIMEOUT_MS);
    const result = await run;

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_REPLY_TIMEOUT'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: false,
      },
      judge: { status: 'not_run' },
    });
    expect(JSON.stringify(result)).not.toContain('late eligible private sentinel');
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it('closes an unexpected capture throw with no achieved transport facts', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom).mockRejectedValueOnce(
      new Error('private capture throw sentinel')
    );

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: false,
        outboundSent: false,
        eligiblePuppetTextObserved: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('private capture throw sentinel');
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).not.toHaveBeenCalled();
  });

  it('closes an unexpected send throw while preserving the captured cursor fact', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).mockRejectedValueOnce(
      new Error('private send throw sentinel')
    );

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: false,
        eligiblePuppetTextObserved: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('private send throw sentinel');
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it('closes an unexpected poll throw while preserving capture and outbound facts', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom)
      .mockResolvedValueOnce({
        ok: true,
        nextBatch: 'capture-cursor',
        limited: false,
        events: [],
      })
      .mockRejectedValueOnce(new Error('private poll throw sentinel'));

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('private poll throw sentinel');
    expect(dependencies.judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });

  it('closes a withAccountContext throw before any account-scoped dependency call', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.withAccountContext).mockRejectedValue(
      new Error('private context port throw sentinel')
    );

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: false,
        outboundSent: false,
        eligiblePuppetTextObserved: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('private context port throw sentinel');
    expect(dependencies.matrix.syncTargetRoom).not.toHaveBeenCalled();
  });
});

describe('Matrix smoke judge result and privacy', () => {
  it('passes the exact Matrix-only judge input and projects verdict and usage field by field', async () => {
    const { dependencies } = createDependencies();
    const usageWithPrivateField = {
      ...USAGE,
      privateUsageSentinel: 'private usage sentinel',
    };
    vi.mocked(dependencies.judgeMatrixSmokeReply).mockResolvedValue({
      ok: true,
      verdict: passVerdict(),
      usage: usageWithPrivateField,
    });

    const result = await runMatrixSmoke(dependencies);

    expect(dependencies.judgeMatrixSmokeReply).toHaveBeenCalledTimes(1);
    expect(dependencies.judgeMatrixSmokeReply).toHaveBeenCalledWith({
      assistantText: 'Proszę podać treść notatki.',
      semanticCriteria: [
        'understands that note content is missing',
        'asks the user for that content',
        'does not claim any save or other action completed',
        'is concise, clear, professional, and not passive-aggressive',
      ],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
        hiddenToolAudit: 'not_available',
      },
    });
    expect(result).toEqual({
      effectiveKind: 'passed',
      exitCode: 0,
      failureCodes: [],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
        hiddenToolAudit: 'not_available',
      },
      judge: {
        status: 'completed',
        verdict: {
          pass: true,
          score: 5,
          criteria: {
            understoodIntent: true,
            helpful: true,
            conciseAndClear: true,
            professionalTone: true,
            noPassiveAggression: true,
          },
          failures: [],
        },
        usage: USAGE,
      },
      durationMs: 50,
    });
    expect(JSON.stringify(result)).not.toContain('private usage sentinel');
    expect(JSON.stringify(result)).not.toContain('private judge rationale sentinel');
  });

  it('preserves a valid provider total that is not additive', async () => {
    const { dependencies } = createDependencies();
    const nonAdditiveUsage: JudgeUsageSummary = { ...USAGE, totalTokens: 99 };
    vi.mocked(dependencies.judgeMatrixSmokeReply).mockResolvedValue({
      ok: true,
      verdict: passVerdict(),
      usage: nonAdditiveUsage,
    });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      effectiveKind: 'passed',
      exitCode: 0,
      judge: { status: 'completed', usage: nonAdditiveUsage },
    });
  });

  it.each([
    ['negative logical calls', { ...USAGE, logicalCalls: -1 }],
    ['repair count above logical calls', { ...USAGE, logicalCalls: 0, repairCount: 1 }],
    ['unsafe input tokens', { ...USAGE, inputTokens: Number.MAX_SAFE_INTEGER + 1 }],
    ['NaN provider cost', { ...USAGE, providerReportedUsd: Number.NaN }],
  ] as const)('closes malformed judge usage: %s', async (_label, usage) => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.judgeMatrixSmokeReply).mockResolvedValue({
      ok: true,
      verdict: passVerdict(),
      usage,
    });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
      },
      judge: { status: 'not_run' },
    });
  });

  it('returns a coherent behavioral failure without an infrastructure code or rationale', async () => {
    const { dependencies } = createDependencies();
    const verdict: MiniMaxJudgeVerdict = {
      pass: false,
      score: 2,
      criteria: {
        understoodIntent: true,
        helpful: false,
        conciseAndClear: true,
        professionalTone: true,
        noPassiveAggression: true,
      },
      failures: ['missing_information'],
      rationale: 'private behavioral rationale sentinel',
    };
    vi.mocked(dependencies.judgeMatrixSmokeReply).mockResolvedValue({
      ok: true,
      verdict,
      usage: USAGE,
    });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      effectiveKind: 'behavioral_failure',
      exitCode: 1,
      failureCodes: [],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
        hiddenToolAudit: 'not_available',
      },
      judge: {
        status: 'completed',
        verdict: {
          pass: false,
          score: 2,
          failures: ['missing_information'],
        },
        usage: USAGE,
      },
    });
    expect(JSON.stringify(result)).not.toContain('private behavioral rationale sentinel');
    expect(JSON.stringify(result.judge)).not.toContain('rationale');
  });

  it.each([
    'MINIMAX_JUDGE_KEY_MISSING',
    'MINIMAX_JUDGE_TIMEOUT',
    'MINIMAX_JUDGE_PROVIDER_FAILED',
    'MINIMAX_JUDGE_INVALID_OUTPUT',
    'MINIMAX_JUDGE_USAGE_INVALID',
  ] as const)(
    'preserves closed MiniMax infrastructure result %s and exact partial usage',
    async (code) => {
      const { dependencies } = createDependencies();
      const partialUsageWithPrivateField = {
        logicalCalls: 1,
        repairCount: 1,
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10,
        providerReportedUsd: 0.0007,
        providerReportedUsdComplete: false,
        privateUsageSentinel: 'private partial usage sentinel',
      };
      vi.mocked(dependencies.judgeMatrixSmokeReply).mockResolvedValue({
        ok: false,
        code,
        usage: partialUsageWithPrivateField,
      });

      const result = await runMatrixSmoke(dependencies);

      expect(result).toEqual({
        effectiveKind: 'infrastructure_failure',
        exitCode: 2,
        failureCodes: [code],
        transportFacts: {
          cursorCaptured: true,
          outboundSent: true,
          eligiblePuppetTextObserved: true,
          hiddenToolAudit: 'not_available',
        },
        judge: {
          status: 'infrastructure_failure',
          code,
          usage: {
            logicalCalls: 1,
            repairCount: 1,
            inputTokens: 7,
            outputTokens: 3,
            totalTokens: 10,
            providerReportedUsd: 0.0007,
            providerReportedUsdComplete: false,
          },
        },
        durationMs: 50,
      });
      expect(JSON.stringify(result)).not.toContain('private partial usage sentinel');
    }
  );

  it('maps a judge throw to unexpected while retaining achieved transport facts', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.judgeMatrixSmokeReply).mockRejectedValue(
      new Error('private judge throw sentinel')
    );

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
        hiddenToolAudit: 'not_available',
      },
      judge: { status: 'not_run' },
    });
    expect(JSON.stringify(result)).not.toContain('private judge throw sentinel');
  });

  it('executes the secret-bearing callback at most once even if the port invokes it twice', async () => {
    const { dependencies } = createDependencies();
    dependencies.withAccountContext = vi.fn(async (callback) => {
      await callback(CONTEXT);
      await callback(CONTEXT);
      return { ok: true as const, checks: [] };
    });

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({ effectiveKind: 'passed', exitCode: 0 });
    expect(dependencies.whatsapp.sendPrivateOutboundMatrixMessage).toHaveBeenCalledTimes(1);
    expect(dependencies.judgeMatrixSmokeReply).toHaveBeenCalledTimes(1);
    expect(dependencies.matrix.syncTargetRoom).toHaveBeenCalledTimes(2);
  });

  it('maps helper callback failure and a missing callback result to closed unexpected failures', async () => {
    const callbackFailure = createDependencies().dependencies;
    vi.mocked(callbackFailure.withAccountContext).mockResolvedValue({
      ok: false,
      code: 'UNEXPECTED_FAILURE',
      checks: [],
    });
    await expect(runMatrixSmoke(callbackFailure)).resolves.toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
    });

    const missingCallback = createDependencies().dependencies;
    vi.mocked(missingCallback.withAccountContext).mockResolvedValue({ ok: true, checks: [] });
    await expect(runMatrixSmoke(missingCallback)).resolves.toMatchObject({
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
    });
  });

  it.each([
    [-1, 10],
    [1.5, 10],
    [1, 1.5],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ] as const)('closes invalid duration clock values %s → %s', async (startedAt, completedAt) => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.nowMs).mockReturnValueOnce(startedAt).mockReturnValueOnce(completedAt);

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      durationMs: 0,
    });
    expect(Number.isSafeInteger(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('preserves a paid completed judge result when the completion clock is invalid', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.nowMs).mockReturnValueOnce(1_000).mockReturnValueOnce(Number.NaN);

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
      },
      judge: {
        status: 'completed',
        verdict: { pass: true },
        usage: USAGE,
      },
      durationMs: 0,
    });
  });

  it('preserves paid MiniMax failure usage and appends unexpected on invalid completion clock', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.judgeMatrixSmokeReply).mockResolvedValue({
      ok: false,
      code: 'MINIMAX_JUDGE_TIMEOUT',
      usage: USAGE,
    });
    vi.mocked(dependencies.nowMs)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(Number.MAX_SAFE_INTEGER + 1);

    const result = await runMatrixSmoke(dependencies);

    expect(result).toMatchObject({
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
      failureCodes: ['MINIMAX_JUDGE_TIMEOUT', 'MATRIX_UNEXPECTED_FAILURE'],
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
      },
      judge: {
        status: 'infrastructure_failure',
        code: 'MINIMAX_JUDGE_TIMEOUT',
        usage: USAGE,
      },
      durationMs: 0,
    });
  });

  it('serializes no rationale, prompt/reply text, criteria, nonce, context, cursor, or IDs', async () => {
    const { dependencies } = createDependencies();
    vi.mocked(dependencies.matrix.syncTargetRoom).mockResolvedValueOnce({
      ok: true,
      nextBatch: 'capture-cursor',
      limited: false,
      events: [eligibleEvent('private capture-history body sentinel')],
    });

    const result = await runMatrixSmoke(dependencies);
    const serialized = JSON.stringify(result);

    for (const privateValue of [
      'private judge rationale sentinel',
      'Proszę podać treść notatki.',
      'understands that note content is missing',
      UUID,
      `intex-agent-eval-matrix-${UUID}`,
      CONTEXT.userId,
      CONTEXT.matrixUserId,
      CONTEXT.homeserverUrl,
      CONTEXT.accessToken,
      CONTEXT.targetRoomId,
      '$private-outbound-event',
      'private capture-history body sentinel',
      'capture-cursor',
      'reply-cursor',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toContain('rationale');
    expect(serialized).not.toContain('assistantText');
    expect(serialized).not.toContain('semanticCriteria');
    expect(dependencies.judgeMatrixSmokeReply).toHaveBeenCalledWith(
      expect.objectContaining({ assistantText: 'Proszę podać treść notatki.' })
    );
  });

  it('constructs the production runner without live calls or MiniMax construction', () => {
    const matrix: MatrixClient = {
      whoAmI: vi.fn(async () => ({ ok: true as const, userId: CONTEXT.matrixUserId })),
      syncTargetRoom: vi.fn(async () => ({
        ok: true as const,
        nextBatch: 'unused-cursor',
        limited: false,
        events: [],
      })),
    };
    const judgeMatrixSmokeReply = vi.fn(async () => passJudgeResult());

    const runner = createProductionMatrixSmokeRunner({ matrix, judgeMatrixSmokeReply });

    expect(runner).toEqual(expect.any(Function));
    expect(matrix.whoAmI).not.toHaveBeenCalled();
    expect(matrix.syncTargetRoom).not.toHaveBeenCalled();
    expect(judgeMatrixSmokeReply).not.toHaveBeenCalled();
  });
});
