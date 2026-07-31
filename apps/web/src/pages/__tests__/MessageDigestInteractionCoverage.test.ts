import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface InteractionEvidence {
  id: string;
  assertions: NamedAssertion[];
}

interface NamedAssertion {
  assertion: string;
  file: string;
}

const repositoryRoot = findRepositoryRoot(process.cwd());
const executionGoalPath = `${repositoryRoot}/docs/superpowers/plans/2026-07-27-whatsapp-message-digests-execution-goal.md`;

const WEB = 'apps/web/src';
const DIGEST_BACKEND = 'apps/message-digest-service/src';
const WHATSAPP_BACKEND = 'apps/whatsapp-service/src';

function findRepositoryRoot(startPath: string): string {
  let candidate = resolve(startPath);

  while (true) {
    if (existsSync(resolve(candidate, 'pnpm-workspace.yaml'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error('Unable to resolve repository root');
    candidate = parent;
  }
}

const INTERACTION_COVERAGE = [
  {
    id: 'NAV-01',
    assertions: [
      named(
        `${WEB}/components/sidebar/__tests__/CollapsibleNavSection.test.tsx`,
        'opens by keyboard, closes by pointer, and exposes the expanded state'
      ),
      named(
        `${WEB}/components/__tests__/Sidebar.test.tsx`,
        'keeps Message Digests active and WhatsApp expanded on nested route %s'
      ),
    ],
  },
  {
    id: 'NAV-02',
    assertions: [
      named(
        `${WEB}/components/__tests__/Sidebar.test.tsx`,
        'keeps Message Digests active and WhatsApp expanded on nested route %s'
      ),
    ],
  },
  {
    id: 'NAV-03',
    assertions: [
      named(
        `${WEB}/components/__tests__/Sidebar.test.tsx`,
        'keeps unrelated Mobile links and saved filters working without legacy Digests'
      ),
    ],
  },
  {
    id: 'LIST-01',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestsPages.test.tsx`,
        'starts with recently-updated server ordering and canonical creation navigation'
      ),
    ],
  },
  {
    id: 'LIST-02',
    assertions: [
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'reports refresh success truthfully while preserving confirmed rows on failure'
      ),
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'rejects a stale response after the query fingerprint changes'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'retains rows during refresh and load-more failures with distinct live feedback'
      ),
    ],
  },
  {
    id: 'LIST-03',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestsPages.test.tsx`,
        'uses name ordering for search and restores the user’s prior sort when search clears'
      ),
    ],
  },
  {
    id: 'LIST-04',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestsPages.test.tsx`,
        'uses history entries for discrete filters and restores them through Back and Forward'
      ),
    ],
  },
  {
    id: 'LIST-05',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestsPages.test.tsx`,
        'passes status and conversation filters to the server and resets all controls'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'distinguishes first use from an empty filtered result'
      ),
    ],
  },
  {
    id: 'LIST-06',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'exposes sortable table headers with the current direction and atomic header intent'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestsPages.test.tsx`,
        'uses name ordering for search and restores the user’s prior sort when search clears'
      ),
    ],
  },
  {
    id: 'LIST-07',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'opens the exact owned detail from the name without opening the row action menu'
      ),
    ],
  },
  {
    id: 'LIST-08',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx`,
        'closes on Escape and outside pointer interaction and restores trigger focus'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestResponsiveContracts.test.tsx`,
        'uses semantic desktop table and mobile cards without nested controls or sub-44px actions'
      ),
    ],
  },
  {
    id: 'LIST-09',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx`,
        'invokes only the declared %s mutation'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx`,
        'isolates the %s lifecycle action from every other mutation'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'locks only the pending row and keeps a failed lifecycle mutation visible without optimistic state'
      ),
    ],
  },
  {
    id: 'LIST-10',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestsPages.test.tsx`,
        'passes status and conversation filters to the server and resets all controls'
      ),
    ],
  },
  {
    id: 'LIST-11',
    assertions: [
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'loads more once and deduplicates immutable definitions by ID'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'retains rows during refresh and load-more failures with distinct live feedback'
      ),
    ],
  },
  {
    id: 'LIST-12',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'keeps an initial error separate from empty state and offers retry'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'distinguishes first use from an empty filtered result'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
        'shows source setup state %s'
      ),
    ],
  },
  {
    id: 'FORM-01',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestEditorPages.test.tsx`,
        'guards dirty cancellation and lets a clean form leave immediately'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestEditorPages.test.tsx`,
        'blocks sidebar, browser Back, local Back, and Cancel, then resumes the exact navigation'
      ),
    ],
  },
  {
    id: 'FORM-02',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'trims the digest name and exposes its 80-character bound, count, error, and focus'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'submits trimmed values without recipient data'
      ),
    ],
  },
  {
    id: 'FORM-03',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'tracks dirty state for Cancel and beforeunload, but keeps a locked source immutable'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'supports keyboard-only unique selection, enables Use only after selection, and restores focus'
      ),
    ],
  },
  {
    id: 'PICK-01',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'filters loaded conversations by search and All, Groups, or Direct tabs'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'supports keyboard-only unique selection, enables Use only after selection, and restores focus'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'keeps initial and pagination errors distinct and supports retry'
      ),
    ],
  },
  {
    id: 'PICK-02',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'shows group/direct metadata, disables unknown sources, and returns only the public selection'
      ),
      named(
        `${WHATSAPP_BACKEND}/__tests__/domain/whatsapp/privateWhatsAppDigestSource.test.ts`,
        'rejects unknown chat types and foreign ownership without exposing stored identifiers'
      ),
    ],
  },
  {
    id: 'PICK-03',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'loads cursor pages once, deduplicates chats, and keeps long names wrapped'
      ),
    ],
  },
  {
    id: 'PICK-04',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'supports keyboard-only unique selection, enables Use only after selection, and restores focus'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'closes on Cancel and returns focus to the trigger'
      ),
    ],
  },
  {
    id: 'PROMPT-01',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'selecting %s inserts the matching editable template into empty instructions'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'requires confirmation before replacing non-empty instructions with a template'
      ),
    ],
  },
  {
    id: 'PROMPT-02',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'uses the exact approved direct-sentiment prompt with uncertainty and anti-diagnosis safeguards'
      ),
    ],
  },
  {
    id: 'PROMPT-03',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'keeps multiline Enter inside the editor and associates its count and 20–4,000 errors'
      ),
    ],
  },
  {
    id: 'PROMPT-04',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'renders a generated Markdown preview from the exact backend window without mutating the form'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'repeats an identical read-only preview without saving or delivering'
      ),
    ],
  },
  {
    id: 'PROMPT-05',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'switches to Custom without mutating instructions and returns focus to the editor'
      ),
    ],
  },
  {
    id: 'PROMPT-06',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'preserves form state across preview retry and returns focus on close without persisting'
      ),
    ],
  },
  {
    id: 'SCHED-01',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestScheduleFields.test.tsx`,
        'reveals the weekly day only for weekly cadence and emits a closed schedule union'
      ),
    ],
  },
  {
    id: 'SCHED-02',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestScheduleFields.test.tsx`,
        'shows only backend-calculated boundaries and the exact DST rule'
      ),
      named(
        `${DIGEST_BACKEND}/domain/schedules/messageDigestSchedule.test.ts`,
        'uses the first valid spring instant and earlier autumn occurrence when cadence includes Sunday'
      ),
    ],
  },
  {
    id: 'SCHED-03',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestScheduleFields.test.tsx`,
        'renders delivery readiness %s without a recipient control'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestScheduleFields.test.tsx`,
        'offers an explicit retry when readiness observation is unavailable'
      ),
    ],
  },
  {
    id: 'SCHED-04',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'explains readiness %s and that an active digest may be saved paused'
      ),
    ],
  },
  {
    id: 'FORM-04',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestEditorPages.test.tsx`,
        'creates once and navigates to the canonical detail with activation context'
      ),
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'recovers create after reload with the same session-safe request ID'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`,
        'locks cancel, preview, and submit while one save mutation is pending'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestEditorPages.test.tsx`,
        'offers an explicit latest-version reload after a revision conflict'
      ),
    ],
  },
  {
    id: 'FORM-05',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestEditorPages.test.tsx`,
        'blocks sidebar, browser Back, local Back, and Cancel, then resumes the exact navigation'
      ),
    ],
  },
  {
    id: 'DETAIL-01',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestEditorPages.test.tsx`,
        'hydrates a locked source and sends a minimal CAS patch'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestEditorPages.test.tsx`,
        'offers an explicit latest-version reload after a revision conflict'
      ),
    ],
  },
  {
    id: 'DETAIL-02',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestDetailPage.test.tsx`,
        'prepares the server window before confirmation and starts one canonical run'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestDetailPage.test.tsx`,
        'recovers a confirmed run after reload without preparing a second window'
      ),
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'replays a lost run response after reload without changing the logical request ID'
      ),
    ],
  },
  {
    id: 'DETAIL-03',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestDetailPage.test.tsx`,
        'pauses atomically with revision CAS and adopts the authoritative PATCH response'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestDetailPage.test.tsx`,
        'blocks resume for delivery readiness %s with a visible settings action'
      ),
    ],
  },
  {
    id: 'DETAIL-04',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDeleteDialog.test.tsx`,
        'requires explicit confirmation and explains that the source chat is untouched'
      ),
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestDeleteDialog.test.tsx`,
        'restores an interrupted erasure and cannot be dismissed while deletion is pending'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestsPages.test.tsx`,
        'restores focus to the list heading after terminal deletion redirect'
      ),
    ],
  },
  {
    id: 'DETAIL-05',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestDetailPage.test.tsx`,
        'copies only visible instructions and announces clipboard failure'
      ),
    ],
  },
  {
    id: 'DETAIL-06',
    assertions: [
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'stops after terminal generation=%s delivery=%s'
      ),
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'suppresses a stale request after an explicit refresh'
      ),
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'retains the latest run during a transient polling failure and recovers'
      ),
    ],
  },
  {
    id: 'DETAIL-07',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestDetailPage.test.tsx`,
        'carries explicit heading focus intent into full history'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'focuses the history heading when the previous route requests a focus transfer'
      ),
      named(
        `${WEB}/components/routing/__tests__/ProtectedLayout.test.tsx`,
        'renders the child outlet when authenticated'
      ),
    ],
  },
  {
    id: 'HIST-01',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'restores exact URL filters, passes them to the API hook, and clears deterministically'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'distinguishes an empty history from a filtered no-match state and clears it'
      ),
    ],
  },
  {
    id: 'HIST-02',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'retains rows on pagination errors and exposes one guarded Load more action'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'keeps confirmed rows visible when a manual refresh fails'
      ),
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'loads cursor pages in window order and deduplicates immutable runs'
      ),
    ],
  },
  {
    id: 'HIST-03',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'renders semantic desktop columns, local times, separate statuses, and canonical result links'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'maps a foreign or missing run to the same owner-safe not-found state'
      ),
    ],
  },
  {
    id: 'RUN-01',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'renders sanitized output, snapshots, a safe delivery timeline, and collapsed technical details'
      ),
    ],
  },
  {
    id: 'RUN-02',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'offers delivery retry only for a definitive safe failure and preserves content'
      ),
      named(
        `${DIGEST_BACKEND}/domain/usecases/retryMessageDigestRun.test.ts`,
        'retries definitive pre-provider delivery failure %s with byte-identical payload'
      ),
    ],
  },
  {
    id: 'RUN-03',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'blocks raw HTML, scriptable links, layout-breaking images, and unsafe link targets'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'renders sanitized output, snapshots, a safe delivery timeline, and collapsed technical details'
      ),
    ],
  },
  {
    id: 'RUN-04',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'retries SOURCE_CHANGED as the same run and shows its exact immutable window'
      ),
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'retries SOURCE_CHANGED on the exact run with one stable request and no replacement reservation'
      ),
    ],
  },
  {
    id: 'LEGACY-01',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestLegacyRedirectPage.test.tsx`,
        'resolves legacy detail route %s to the canonical run'
      ),
    ],
  },
  {
    id: 'CTA-01',
    assertions: [
      named(
        `${WEB}/__tests__/App.authenticatedLanding.test.tsx`,
        'returns an authenticated WhatsApp CTA to the exact canonical run route once'
      ),
    ],
  },
] satisfies InteractionEvidence[];

const CONTROLLED_RESPONSE_COVERAGE = [
  controlled(
    'loading',
    named(
      `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
      'shows an announced skeleton only during initial loading'
    )
  ),
  controlled(
    'empty',
    named(
      `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
      'distinguishes first use from an empty filtered result'
    )
  ),
  controlled(
    'initial error',
    named(
      `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
      'keeps an initial error separate from empty state and offers retry'
    )
  ),
  controlled(
    'retained refresh/load-more error',
    named(
      `${WEB}/components/message-digests/__tests__/MessageDigestList.test.tsx`,
      'retains rows during refresh and load-more failures with distinct live feedback'
    )
  ),
  controlled(
    'stale revision',
    named(
      `${WEB}/pages/__tests__/MessageDigestEditorPages.test.tsx`,
      'offers an explicit latest-version reload after a revision conflict'
    )
  ),
  controlled(
    'source change',
    named(
      `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
      'retries SOURCE_CHANGED as the same run and shows its exact immutable window'
    )
  ),
  controlled(
    'generation failure',
    named(
      `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
      'confirms a generation retry, locks the dialog while pending, and announces success'
    )
  ),
  controlled(
    'source unavailable',
    named(
      `${WEB}/pages/__tests__/MessageDigestDetailPage.test.tsx`,
      'blocks run and resume while the source conversation is unavailable'
    )
  ),
  controlled(
    'source too large',
    named(
      `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
      'renders source-too-large as a terminal safe generation failure without delivery or retry'
    )
  ),
  controlled(
    'readiness request failure',
    named(
      `${WEB}/components/message-digests/__tests__/MessageDigestScheduleFields.test.tsx`,
      'offers an explicit retry when readiness observation is unavailable'
    )
  ),
  controlled(
    'mapping missing',
    named(
      `${WEB}/components/message-digests/__tests__/MessageDigestScheduleFields.test.tsx`,
      'renders delivery readiness %s without a recipient control'
    )
  ),
  {
    state: 'delivery failed/ambiguous',
    assertions: [
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'offers delivery retry only for a definitive safe failure and preserves content'
      ),
      named(
        `${WEB}/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`,
        'warns about ambiguous delivery without exposing a blind retry'
      ),
    ],
  },
  controlled(
    'interrupted erasure',
    named(
      `${WEB}/components/message-digests/__tests__/MessageDigestDeleteDialog.test.tsx`,
      'restores an interrupted erasure and cannot be dismissed while deletion is pending'
    )
  ),
  {
    state: 'auth switch',
    assertions: [
      named(
        `${WEB}/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx`,
        'discards stale conversations when the authenticated account changes'
      ),
      named(
        `${WEB}/hooks/__tests__/useMessageDigests.test.ts`,
        'cancels the prior account request and timer before loading the new account'
      ),
    ],
  },
] satisfies { state: string; assertions: NamedAssertion[] }[];

function named(file: string, assertion: string): NamedAssertion {
  return { file, assertion };
}

function controlled(
  state: string,
  assertion: NamedAssertion
): { state: string; assertions: NamedAssertion[] } {
  return { state, assertions: [assertion] };
}

function interactionIdsFromGoal(): string[] {
  return [...readFileSync(executionGoalPath, 'utf8').matchAll(/^\| ([A-Z]+-\d+) \|/gm)].map(
    ([, id]) => id
  );
}

describe('Message Digest interaction coverage contract', () => {
  it('maps every execution-goal interaction ID to a named automated assertion', () => {
    const expectedIds = interactionIdsFromGoal();
    const mappedIds = INTERACTION_COVERAGE.map(({ id }) => id);

    expect(expectedIds).toHaveLength(50);
    expect(new Set(expectedIds).size).toBe(expectedIds.length);
    expect(mappedIds).toEqual(expectedIds);

    for (const evidence of INTERACTION_COVERAGE) {
      expect(evidence.assertions.length, `${evidence.id}: named assertions`).toBeGreaterThan(0);
      for (const assertion of evidence.assertions) {
        const source = readFileSync(`${repositoryRoot}/${assertion.file}`, 'utf8');

        expect(source, `${evidence.id}: ${assertion.assertion}`).toContain(assertion.assertion);
      }
    }
  });

  it('maps every required controlled-response state to a named automated assertion', () => {
    expect(CONTROLLED_RESPONSE_COVERAGE.map(({ state }) => state)).toEqual([
      'loading',
      'empty',
      'initial error',
      'retained refresh/load-more error',
      'stale revision',
      'source change',
      'generation failure',
      'source unavailable',
      'source too large',
      'readiness request failure',
      'mapping missing',
      'delivery failed/ambiguous',
      'interrupted erasure',
      'auth switch',
    ]);

    for (const evidence of CONTROLLED_RESPONSE_COVERAGE) {
      expect(evidence.assertions.length, `${evidence.state}: named assertions`).toBeGreaterThan(0);
      for (const assertion of evidence.assertions) {
        const source = readFileSync(`${repositoryRoot}/${assertion.file}`, 'utf8');

        expect(source, `${evidence.state}: ${assertion.assertion}`).toContain(assertion.assertion);
      }
    }
  });
});
