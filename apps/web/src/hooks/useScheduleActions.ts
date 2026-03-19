import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import type { CronSchedule, CronScheduleStatus } from '@/types';

/**
 * Manages action state (updating, triggering, deleting) for a schedule detail page.
 * Wraps the useCronSchedule hook's update/trigger/remove methods with loading
 * and error state management.
 */
export function useScheduleActions(
  schedule: CronSchedule | null,
  hooks: {
    update: (updates: Partial<{ name: string; status: CronScheduleStatus; action: CronSchedule['action'] }>) => Promise<void>;
    trigger: () => Promise<void>;
    remove: () => Promise<void>;
    refreshSchedule: () => Promise<void>;
    refreshExecutions: (showLoading?: boolean) => Promise<void>;
  },
): {
  updating: boolean;
  triggering: boolean;
  deleting: boolean;
  showDeleteConfirm: boolean;
  actionError: string | null;
  handlePauseResume: () => void;
  handleTrigger: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleNameSave: (newName: string) => void;
  handleInstructionSave: (newInstruction: string) => void;
  setShowDeleteConfirm: (show: boolean) => void;
} {
  const [updating, setUpdating] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  const handleUpdate = useCallback(
    async (updates: Parameters<typeof hooks.update>[0]): Promise<void> => {
      setUpdating(true);
      setActionError(null);

      try {
        await hooks.update(updates);
      } catch (err) {
        if (isMountedRef.current) {
          setActionError(getErrorMessage(err));
        }
      } finally {
        if (isMountedRef.current) {
          setUpdating(false);
        }
      }
    },
    [hooks.update],
  );

  const handlePauseResume = useCallback((): void => {
    if (schedule === null) return;
    const newStatus: CronScheduleStatus = schedule.status === 'active' ? 'paused' : 'active';
    void handleUpdate({ status: newStatus });
  }, [schedule, handleUpdate]);

  const handleTrigger = useCallback(async (): Promise<void> => {
    setTriggering(true);
    setActionError(null);

    try {
      await hooks.trigger();
      if (isMountedRef.current) {
        void hooks.refreshSchedule();
        void hooks.refreshExecutions(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setActionError(getErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setTriggering(false);
      }
    }
  }, [hooks.trigger, hooks.refreshSchedule, hooks.refreshExecutions]);

  const handleDelete = useCallback(async (): Promise<void> => {
    setDeleting(true);
    setActionError(null);

    try {
      await hooks.remove();
    } catch (err) {
      if (isMountedRef.current) {
        setActionError(getErrorMessage(err));
        setDeleting(false);
        setShowDeleteConfirm(false);
      }
    }
  }, [hooks.remove]);

  const handleNameSave = useCallback(
    (newName: string): void => {
      void handleUpdate({ name: newName });
    },
    [handleUpdate],
  );

  const handleInstructionSave = useCallback(
    (newInstruction: string): void => {
      if (schedule === null) return;
      void handleUpdate({
        action: { ...schedule.action, instruction: newInstruction },
      });
    },
    [schedule, handleUpdate],
  );

  return {
    updating,
    triggering,
    deleting,
    showDeleteConfirm,
    actionError,
    handlePauseResume,
    handleTrigger,
    handleDelete,
    handleNameSave,
    handleInstructionSave,
    setShowDeleteConfirm,
  };
}
