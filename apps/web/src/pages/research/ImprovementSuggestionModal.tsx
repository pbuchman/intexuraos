import { Sparkles } from 'lucide-react';
import { Button } from '@/components';
import { Modal } from '@/components/ui/Modal';

interface ImprovementSuggestionModalProps {
  open: boolean;
  originalPrompt: string;
  improvedPrompt: string | null;
  onUseOriginal: () => void;
  onUseImproved: () => void;
}

export function ImprovementSuggestionModal(
  props: ImprovementSuggestionModalProps,
): React.JSX.Element | null {
  const { open, originalPrompt, improvedPrompt, onUseOriginal, onUseImproved } = props;

  return (
    <Modal
      open={open}
      onOpenChange={(o): void => {
        if (!o) onUseOriginal();
      }}
      title="Improved Prompt Suggestion"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 mx-4 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800"
    >
      <div className="mb-4 flex items-start gap-3">
        <Sparkles className="mt-0.5 h-6 w-6 flex-shrink-0 text-blue-500 dark:text-blue-400" />
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Improved Prompt Suggestion
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Your prompt could be improved for better research results. Compare the versions
            below:
          </p>
        </div>
      </div>

      <div className="mb-4 space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Original:</p>
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-700 dark:text-slate-300">
            {originalPrompt}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Improved:</p>
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-slate-700 dark:bg-blue-900/30 dark:text-blue-200">
            {improvedPrompt}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onUseOriginal}>
          Use Original
        </Button>
        <Button onClick={onUseImproved}>Use Improved</Button>
      </div>
    </Modal>
  );
}
