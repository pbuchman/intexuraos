import { Sparkles } from 'lucide-react';
import { Button, Card } from '@/components';

interface PromptCardProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onPromptBlur: () => void;
  onAutoImprove: () => void;
  improving: boolean;
  submitting: boolean;
  savingDraft: boolean;
  hasGoogleKey: boolean;
}

export function PromptCard({
  prompt,
  onPromptChange,
  onPromptBlur,
  onAutoImprove,
  improving,
  submitting,
  savingDraft,
  hasGoogleKey,
}: PromptCardProps): React.JSX.Element {
  const isPromptEmpty = prompt.trim().length === 0;
  const improveDisabled = isPromptEmpty || improving || submitting || savingDraft || !hasGoogleKey;
  const improveTitle = !hasGoogleKey
    ? 'Google API key required'
    : isPromptEmpty
      ? 'Enter a prompt first'
      : undefined;

  return (
    <Card title="Research Prompt">
      <div className="space-y-2">
        <textarea
          value={prompt}
          onChange={(e): void => {
            onPromptChange(e.target.value);
          }}
          onBlur={onPromptBlur}
          placeholder="Enter your research question or topic..."
          className="w-full rounded-lg border border-slate-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y min-h-[150px] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400"
          rows={8}
          disabled={submitting || savingDraft}
        />
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {String(prompt.length)}/20000 characters
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={(): void => {
              onAutoImprove();
            }}
            disabled={improveDisabled}
            isLoading={improving}
            title={improveTitle}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Auto Improve
          </Button>
        </div>
      </div>
    </Card>
  );
}
