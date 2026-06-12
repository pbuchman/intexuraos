import { ActionDetailModal, CommandDetailModal } from '@/components';
import type { Action, Command } from '@/types';
import type { ResolvedActionButton } from '@/types/actionConfig';

interface InboxModalsProps {
  selectedAction: Action | null;
  selectedCommand: Command | null;
  commands: Command[];
  onCloseAction: () => void;
  onCloseCommand: () => void;
  onActionSuccess: (button: ResolvedActionButton) => void;
  onActionUpdated: (action: Action) => void;
}

export function InboxModals({
  selectedAction,
  selectedCommand,
  commands,
  onCloseAction,
  onCloseCommand,
  onActionSuccess,
  onActionUpdated,
}: InboxModalsProps): React.JSX.Element {
  return (
    <>
      {selectedAction !== null && (
        <ActionDetailModal
          action={selectedAction}
          command={commands.find((c) => c.id === selectedAction.commandId)}
          onClose={onCloseAction}
          onActionSuccess={onActionSuccess}
          onActionUpdated={onActionUpdated}
        />
      )}
      {selectedCommand !== null && (
        <CommandDetailModal command={selectedCommand} onClose={onCloseCommand} />
      )}
    </>
  );
}
