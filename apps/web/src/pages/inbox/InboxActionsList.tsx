import { ActionItem } from '@/components';
import type { Action } from '@/types';
import type { ResolvedActionButton } from '@/types/actionConfig';
import { ActionsEmptyState } from './InboxEmptyState.js';

interface InboxActionsListProps {
  actions: Action[];
  hasFilters: boolean;
  onSelect: (action: Action) => void;
  onActionSuccess: (button: ResolvedActionButton) => void;
  onActionUpdated: (action: Action) => void;
}

export function InboxActionsList({
  actions,
  hasFilters,
  onSelect,
  onActionSuccess,
  onActionUpdated,
}: InboxActionsListProps): React.JSX.Element {
  if (actions.length === 0) {
    return <ActionsEmptyState hasFilters={hasFilters} />;
  }
  return (
    <>
      {actions.map((action) => (
        <ActionItem
          key={action.id}
          action={action}
          onClick={(): void => {
            onSelect(action);
          }}
          onActionSuccess={onActionSuccess}
          onActionUpdated={onActionUpdated}
        />
      ))}
    </>
  );
}
