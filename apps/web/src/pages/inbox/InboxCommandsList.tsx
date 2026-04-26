import { CommandItem } from '@/components/inbox/CommandItem.js';
import type { Command } from '@/types';
import { CommandsEmptyState } from './InboxEmptyState.js';

interface InboxCommandsListProps {
  commands: Command[];
  deletingCommandId: string | null;
  archivingCommandId: string | null;
  onSelect: (command: Command) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
}

export function InboxCommandsList({
  commands,
  deletingCommandId,
  archivingCommandId,
  onSelect,
  onDelete,
  onArchive,
}: InboxCommandsListProps): React.JSX.Element {
  if (commands.length === 0) {
    return <CommandsEmptyState />;
  }
  return (
    <>
      {commands.map((command) => (
        <CommandItem
          key={command.id}
          command={command}
          onClick={(): void => {
            onSelect(command);
          }}
          onDelete={onDelete}
          onArchive={onArchive}
          isDeleting={deletingCommandId === command.id}
          isArchiving={archivingCommandId === command.id}
        />
      ))}
    </>
  );
}
