import { Trash2 } from 'lucide-react';
import { Button } from '@/components';

interface ResearchActionBarProps {
  isEditMode: boolean;
  prompt: string;
  canSubmit: boolean;
  submitting: boolean;
  savingDraft: boolean;
  discarding: boolean;
  validating: boolean;
  disabledReason: string | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes: caller passes explicit undefined
  onDiscardClick: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
}

export function ResearchActionBar(props: ResearchActionBarProps): React.JSX.Element {
  const {
    isEditMode,
    prompt,
    canSubmit,
    submitting,
    savingDraft,
    discarding,
    validating,
    disabledReason,
    onDiscardClick,
    onSaveDraft,
    onSubmit,
  } = props;

  const isPromptEmpty = prompt.trim().length === 0;

  return (
    <div className="flex gap-3">
      {isEditMode ? (
        <Button
          type="button"
          variant="danger"
          onClick={onDiscardClick}
          disabled={submitting || savingDraft || discarding}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Discard Draft
        </Button>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        onClick={(): void => {
          onSaveDraft();
        }}
        disabled={isPromptEmpty || submitting || savingDraft}
        isLoading={savingDraft}
        title={isPromptEmpty ? 'Enter a prompt to save draft' : undefined}
      >
        Save as Draft
      </Button>
      <Button
        type="button"
        onClick={(): void => {
          onSubmit();
        }}
        disabled={!canSubmit || submitting || savingDraft || validating}
        isLoading={submitting || validating}
        title={disabledReason}
      >
        {validating ? 'Validating...' : 'Start Research'}
      </Button>
    </div>
  );
}
