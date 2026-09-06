import { ArrowLeft, Bot } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CONVERSATION_ASSISTANT_MODEL_OPTIONS,
  type ConversationAssistantModel,
} from '@intexuraos/llm-contract';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { useWhatsAppConversationAssistant } from '@/hooks/useWhatsAppConversationAssistant';

export function WhatsAppConversationAssistantNewPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const sourceSessionId = searchParams.get('sourceSession') ?? undefined;
  const sourceChatDisplayName = searchParams.get('contact') ?? undefined;
  const requestedModel = searchParams.get('model');
  const requestedFrom = searchParams.get('from');
  const requestedTo = searchParams.get('to');
  const assistant = useWhatsAppConversationAssistant({
    loadChats: sourceSessionId === undefined,
    loadSessions: false,
    ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
    ...(requestedFrom === null ? {} : { initialFrom: requestedFrom }),
    ...(requestedTo === null ? {} : { initialTo: requestedTo }),
    ...(requestedModel !== null &&
    CONVERSATION_ASSISTANT_MODEL_OPTIONS.some((model) => model.id === requestedModel)
      ? { initialModel: requestedModel as ConversationAssistantModel }
      : {}),
  });
  const navigate = useNavigate();
  const selectedModelLabel =
    CONVERSATION_ASSISTANT_MODEL_OPTIONS.find((model) => model.id === assistant.selectedModel)
      ?.label ?? assistant.selectedModel;

  useEffect(() => {
    if (assistant.selectedSessionId !== undefined) {
      void navigate(`/whatsapp/conversation-assistant/${assistant.selectedSessionId}`, {
        replace: true,
      });
    }
  }, [assistant.selectedSessionId, navigate]);

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <header className="border-b border-slate-200 pb-5 dark:border-slate-800">
          <Link
            to="/whatsapp/conversation-assistant"
            className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-50"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to analyses
          </Link>
          <h2 className="mt-4 flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-slate-50">
            <Bot className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            New analysis
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Choose the WhatsApp range that will become the frozen context for a new conversation.
          </p>
        </header>

        <ErrorBanner message={assistant.error} />

        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {sourceSessionId === undefined ? (
              <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Private direct chat
              </span>
              <select
                value={assistant.selectedChatId ?? ''}
                onChange={(event): void => {
                  assistant.selectChat(event.target.value);
                }}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
              >
                <option value="" disabled>
                  Choose a chat
                </option>
                {assistant.directChats.map((chat) => (
                  <option key={chat.id} value={chat.id}>
                    {chat.displayName ?? chat.id}
                  </option>
                ))}
              </select>
              </label>
            ) : (
              <div className="sm:col-span-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Private direct chat
                </span>
                <p className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  {sourceChatDisplayName ?? 'Same conversation as the previous analysis'}
                </p>
              </div>
            )}
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">From</span>
              <input
                type="datetime-local"
                value={assistant.fromDateTimeLocal}
                onChange={(event): void => {
                  assistant.setFromDateTimeLocal(event.target.value);
                }}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">To</span>
              <input
                type="datetime-local"
                value={assistant.toDateTimeLocal}
                onChange={(event): void => {
                  assistant.setToDateTimeLocal(event.target.value);
                }}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
              />
            </label>
          </div>

          <details className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
              Advanced settings
              <span
                aria-label="Selected model"
                className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {selectedModelLabel}
              </span>
            </summary>
            <label className="mt-4 block max-w-md">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Model</span>
              <select
                value={assistant.selectedModel}
                onChange={(event): void => {
                  assistant.selectModel(event.target.value as ConversationAssistantModel);
                }}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
              >
                {CONVERSATION_ASSISTANT_MODEL_OPTIONS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          </details>

          <div className="mt-6 flex flex-col gap-4 border-t border-slate-200 pt-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-sm text-slate-500 dark:text-slate-400">
              This creates the analysis only. You can ask the first question after its frozen
              context is ready, and preparation continues if you leave the page.
            </p>
            <Button
              type="button"
              onClick={(): void => {
                void assistant.createSession();
              }}
              isLoading={assistant.creating}
              loadingText="Starting analysis"
              disabled={
                (sourceSessionId === undefined && assistant.selectedChatId === undefined) ||
                assistant.creating
              }
              className="shrink-0"
            >
              Create analysis
            </Button>
          </div>
        </section>
      </div>
    </Layout>
  );
}
