import { Send } from 'lucide-react';
import { Button } from '@/components';

export function ConversationAssistantComposer({
  value,
  disabled,
  sending,
  onChange,
  onSend,
}: {
  value: string;
  disabled: boolean;
  sending: boolean;
  onChange: (value: string) => void;
  onSend: () => Promise<void>;
}): React.JSX.Element {
  return (
    <form
      className="flex flex-col gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:flex-row"
      onSubmit={(event): void => {
        event.preventDefault();
        void onSend();
      }}
    >
      <label className="sr-only" htmlFor="conversation-assistant-follow-up">
        Ask follow-up
      </label>
      <textarea
        id="conversation-assistant-follow-up"
        value={value}
        onChange={(event): void => {
          onChange(event.target.value);
        }}
        disabled={disabled || sending}
        rows={2}
        className="min-h-12 flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:disabled:bg-slate-800"
        placeholder={disabled ? 'Select or create a session to continue' : 'Ask a follow-up question'}
      />
      <Button
        type="submit"
        size="sm"
        isLoading={sending}
        loadingText="Sending"
        disabled={disabled || sending || value.trim() === ''}
        className="h-10 self-end"
      >
        <Send className="mr-2 h-4 w-4" />
        Send
      </Button>
    </form>
  );
}
