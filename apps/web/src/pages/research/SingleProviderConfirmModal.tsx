import { AlertTriangle } from 'lucide-react';
import { Button, PROVIDER_MODELS } from '@/components';

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
  if (!open) return null;

  const modelName =
    PROVIDER_MODELS.flatMap((p) => p.models).find((m) => m.id === selectedModelId)?.name ??
    selectedModelId ??
    '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
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
      </div>
    </div>
  );
}
