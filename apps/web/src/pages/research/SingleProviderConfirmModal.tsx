import { AlertTriangle } from 'lucide-react';
import { getOpenRouterRawId, isOpenRouterModel } from '@intexuraos/llm-contract';
import { Button } from '@/components';
import { Modal } from '@/components/ui/Modal';
import { resolveOpenRouterModelName } from '@/utils/openRouterModelNames.js';

interface SingleProviderConfirmModalProps {
  open: boolean;
  selectedModelId: string | undefined; // @allow-undefined-type -- caller may pass undefined when selectedModels is empty
  submitting: boolean;
  onCancel: () => void;
  onProceed: () => void;
}

export function SingleProviderConfirmModal(
  props: SingleProviderConfirmModalProps,
): React.JSX.Element | null {
  const { open, selectedModelId, submitting, onCancel, onProceed } = props;

  const modelName =
    selectedModelId !== undefined && isOpenRouterModel(selectedModelId)
      ? resolveOpenRouterModelName(getOpenRouterRawId(selectedModelId))
      : (selectedModelId ?? '');

  return (
    <Modal
      open={open}
      onOpenChange={(o): void => {
        if (!o && !submitting) onCancel();
      }}
      title="Single Model Research"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800"
    >
      <div className="mb-4 flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-500" />
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Single Model Research
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            You selected only one model ({modelName}) and no additional context.
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            The result will show the individual report without synthesis.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={onProceed} disabled={submitting} isLoading={submitting}>
          Proceed
        </Button>
      </div>
    </Modal>
  );
}
