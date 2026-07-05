import { useCallback, useEffect, useRef } from 'react';
import { Bot, Download, RefreshCw } from 'lucide-react';
import { CONVERSATION_ASSISTANT_MODEL_OPTIONS, type ConversationAssistantModel } from '@intexuraos/llm-contract';
import { Button, ErrorBanner, Layout, MarkdownContent } from '@/components';
import { ConversationAssistantComposer } from '@/components/whatsapp/ConversationAssistantComposer';
import { ConversationAssistantSessionRail } from '@/components/whatsapp/ConversationAssistantSessionRail';
import { useWhatsAppConversationAssistant } from '@/hooks/useWhatsAppConversationAssistant';
import type { ConversationAssistantOmittedCounts, ConversationAssistantSession } from '@/types';
import { formatDateTime, formatDateTimeCompact } from '@/utils/dateFormat';

function sumOmitted(omitted: ConversationAssistantOmittedCounts): number {
  return (
    omitted.mediaOnly +
    omitted.failedTranscriptions +
    omitted.pendingTranscriptions +
    omitted.nonText +
    omitted.overLimit
  );
}

function SessionMetadata({
  session,
}: {
  session: ConversationAssistantSession | undefined;
}): React.JSX.Element {
  if (session === undefined) {
    return (
      <div className="grid grid-cols-1 gap-2 text-sm text-slate-500 dark:text-slate-400 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
          No information range
        </div>
        <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
          No effective range
        </div>
        <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">No transcript</div>
        <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">No omissions</div>
        <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">No model</div>
        <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">No role</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
      <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
          Information range
        </div>
        <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
          {formatDateTime(session.range.from)} - {formatDateTime(session.range.to)}
        </div>
      </div>
      <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
          Effective range
        </div>
        <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
          {formatDateTime(session.effectiveRange.from)} - {formatDateTime(session.effectiveRange.to)}
        </div>
      </div>
      <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Transcript</div>
        <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
          {String(session.transcriptMessageCount)} messages
        </div>
        <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
          SHA {session.transcriptSha256}
        </div>
      </div>
      <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Omitted</div>
        <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
          {String(sumOmitted(session.omitted))} omitted
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Media {String(session.omitted.mediaOnly)} · pending {String(session.omitted.pendingTranscriptions)} · failed {String(session.omitted.failedTranscriptions)} · non-text {String(session.omitted.nonText)} · over limit {String(session.omitted.overLimit)}
        </div>
      </div>
      <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Model</div>
        <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
          {session.modelDisplayName}
        </div>
      </div>
      <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Role</div>
        <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
          {session.assistantRoleLabel}
        </div>
      </div>
    </div>
  );
}

export function WhatsAppConversationAssistantPage(): React.JSX.Element {
  const assistant = useWhatsAppConversationAssistant();
  const canExportSelectedSession =
    assistant.selectedSession !== undefined &&
    assistant.turns.length > 0 &&
    !assistant.sending &&
    !assistant.exporting;
  const assistantRoleLabel = assistant.selectedSession?.assistantRoleLabel ?? 'Assistant';
  const selectedSessionId = assistant.selectedSessionId;
  const turnsScrollRef = useRef<HTMLDivElement | null>(null);
  const followTurnsRef = useRef(true);

  const updateTurnScrollFollow = useCallback((): void => {
    const element = turnsScrollRef.current;
    if (element === null) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    followTurnsRef.current = distanceFromBottom < 64;
  }, []);

  useEffect(() => {
    followTurnsRef.current = true;
    const element = turnsScrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [selectedSessionId]);

  useEffect(() => {
    const element = turnsScrollRef.current;
    if (element !== null && followTurnsRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [assistant.loadingTurns, assistant.turns]);

  useEffect(() => {
    if (!assistant.sending) return;
    followTurnsRef.current = true;
    const element = turnsScrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [assistant.sending]);

  return (
    <Layout>
      <div data-testid="whatsapp-conversation-assistant-shell" className="flex w-full min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-slate-50">
              <Bot className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              Conversation Assistant
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Analyze a frozen private direct-chat range and continue autosaved assistant sessions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => {
                void assistant.exportSelectedSessionPdf();
              }}
              isLoading={assistant.exporting}
              loadingText="Exporting"
              disabled={!canExportSelectedSession}
            >
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => {
                void assistant.refresh();
              }}
              isLoading={assistant.loading}
              loadingText="Refreshing"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </header>

        <ErrorBanner message={assistant.error} />

        <div className="grid min-h-[calc(100vh-12rem)] grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <ConversationAssistantSessionRail
            sessions={assistant.sessions}
            selectedSessionId={selectedSessionId}
            loading={assistant.loading}
            onSelectSession={assistant.selectSession}
          />

          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(12rem,0.9fr)_minmax(10rem,0.8fr)_minmax(10rem,0.8fr)]">
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Private direct chat
                  </span>
                  <select
                    value={assistant.selectedChatId ?? ''}
                    onChange={(event): void => {
                      assistant.selectChat(event.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                  >
                    {assistant.directChats.map((chat) => (
                      <option key={chat.id} value={chat.id}>
                        {chat.displayName ?? chat.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Model
                  </span>
                  <select
                    value={assistant.selectedModel}
                    onChange={(event): void => {
                      assistant.selectModel(event.target.value as ConversationAssistantModel);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                  >
                    {CONVERSATION_ASSISTANT_MODEL_OPTIONS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">From</span>
                  <input
                    type="datetime-local"
                    value={assistant.fromDateTimeLocal}
                    onChange={(event): void => {
                      assistant.setFromDateTimeLocal(event.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">To</span>
                  <input
                    type="datetime-local"
                    value={assistant.toDateTimeLocal}
                    onChange={(event): void => {
                      assistant.setToDateTimeLocal(event.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-col gap-2 lg:flex-row">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Optional first question</span>
                  <input
                    type="text"
                    value={assistant.firstQuestion}
                    onChange={(event): void => {
                      assistant.setFirstQuestion(event.target.value);
                    }}
                    placeholder="Optional first question"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={(): void => {
                    void assistant.createSession();
                  }}
                  isLoading={assistant.creating || assistant.checkingContext}
                  loadingText={assistant.checkingContext ? 'Checking' : 'Creating'}
                  disabled={
                    assistant.selectedChatId === undefined ||
                    assistant.creating ||
                    assistant.checkingContext
                  }
                  className="h-10"
                >
                  Create session
                </Button>
              </div>
              {assistant.largeContextWarning !== null ? (
                <div
                  role="alert"
                  className="mt-3 flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 lg:flex-row lg:items-center lg:justify-between"
                >
                  <p className="min-w-0">
                    Selected range contains{' '}
                    {assistant.largeContextWarning.messageCount.toLocaleString()} messages. This may take longer and cost more than usual.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={assistant.dismissLargeContextWarning}
                      disabled={assistant.creating}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={(): void => {
                        void assistant.confirmLargeContextCreate();
                      }}
                      isLoading={assistant.creating}
                      loadingText="Creating"
                    >
                      Continue
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <SessionMetadata session={assistant.selectedSession} />
            </div>

            <div
              ref={turnsScrollRef}
              data-testid="conversation-assistant-turns"
              onScroll={updateTurnScrollFollow}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950"
            >
              {assistant.loadingTurns ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading turns...</p>
              ) : null}
              {!assistant.loadingTurns && assistant.selectedSession === undefined ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Select an assistant session or create a new one.
                </div>
              ) : null}
              {!assistant.loadingTurns && assistant.selectedSession !== undefined && assistant.turns.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  This session has no turns yet.
                </div>
              ) : null}
              {assistant.turns.map((turn) => {
                const isUser = turn.role === 'user';
                return (
                  <article
                    key={turn.id}
                    className={`max-w-[min(42rem,100%)] rounded-lg border px-4 py-3 ${
                      isUser
                        ? 'ml-auto border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
                        : 'mr-auto border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                    }`}
                  >
                    <div className="mb-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                      <span className="min-w-0 flex-1 break-words">
                        {isUser ? 'You' : assistantRoleLabel}
                      </span>
                      <span className="shrink-0">{formatDateTimeCompact(turn.createdAt)}</span>
                    </div>
                    {isUser ? (
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-950 dark:text-slate-50">
                        {turn.text}
                      </p>
                    ) : (
                      <div className="break-words text-sm leading-6 text-slate-950 dark:text-slate-50">
                        <MarkdownContent content={turn.text} />
                      </div>
                    )}
                    {turn.error !== undefined ? (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {turn.error.code}: {turn.error.message}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <ConversationAssistantComposer
              value={assistant.followUpQuestion}
              disabled={assistant.selectedSession === undefined}
              sending={assistant.sending}
              onChange={assistant.setFollowUpQuestion}
              onSend={assistant.sendFollowUp}
            />
          </section>
        </div>
      </div>
    </Layout>
  );
}
