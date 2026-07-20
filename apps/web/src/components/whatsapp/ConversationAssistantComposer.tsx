import { Send } from 'lucide-react';
import { Button } from '@/components';
import type { ConversationAssistantTurnPhase } from '@/hooks/useWhatsAppConversationAssistant';

export function ConversationAssistantComposer({
  value,
  disabled,
  turnPhase,
  mode,
  onChange,
  onSend,
}: {
  value: string;
  disabled: boolean;
  turnPhase: ConversationAssistantTurnPhase;
  mode: 'first-question' | 'follow-up';
  onChange: (value: string) => void;
  onSend: () => Promise<void>;
}): React.JSX.Element {
  const isFirstQuestion = mode === 'first-question';
  const label = isFirstQuestion ? 'Ask first question' : 'Ask follow-up';
  const placeholder = isFirstQuestion
    ? 'Ask your first question about this conversation'
    : 'Ask a follow-up question';

  return (
    <form
      className="flex flex-row items-end gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
      onSubmit={(event): void => {
        event.preventDefault();
        void onSend();
      }}
    >
      <label className="sr-only" htmlFor="conversation-assistant-question">
        {label}
      </label>
      <textarea
        id="conversation-assistant-question"
        value={value}
        onChange={(event): void => {
          onChange(event.target.value);
        }}
        disabled={disabled || turnPhase === 'submitting'}
        rows={2}
        className="min-h-12 min-w-0 flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:disabled:bg-slate-800"
        placeholder={placeholder}
      />
      <Button
        type="submit"
        size="sm"
        isLoading={turnPhase === 'submitting'}
        loadingText="Sending…"
        disabled={disabled || turnPhase !== 'idle' || value.trim() === ''}
        className={`h-12 shrink-0 px-3 ${turnPhase === 'submitting' ? 'w-auto' : 'w-12 sm:w-auto'}`}
      >
        <Send className="h-4 w-4 sm:mr-2" />
        <span className="sr-only sm:not-sr-only">Send</span>
      </Button>
    </form>
  );
}
