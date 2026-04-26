import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components';
import { Modal } from '@/components/ui/Modal';

interface ValidationModalProps {
  open: boolean;
  validating: boolean;
  warning: string | null;
  onDismiss: () => void;
}

export function ValidationModal(props: ValidationModalProps): React.JSX.Element | null {
  const { open, validating, warning, onDismiss } = props;

  return (
    <Modal
      open={open}
      onOpenChange={(o): void => {
        if (!o && !validating) onDismiss();
      }}
      title={validating ? 'Validating research request' : 'Input Quality Issue'}
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800"
    >
      {validating ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Validating your research request...
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-500" />
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Input Quality Issue
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{warning}</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Please revise your prompt and try again.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={onDismiss}>Got it</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
