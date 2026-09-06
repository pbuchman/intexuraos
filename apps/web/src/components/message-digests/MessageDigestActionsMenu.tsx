import {
  Edit3,
  EllipsisVertical,
  Eye,
  LoaderCircle,
  PauseCircle,
  Play,
  PlayCircle,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { MessageDigestDefinition } from '@/types/messageDigests';

export type MessageDigestLifecycleActivation = 'keyboard' | 'pointer';

interface MessageDigestActionsMenuProps {
  definition: MessageDigestDefinition;
  runDisabledReason: string | null;
  lifecycleDisabledReason: string | null;
  deleteDisabledReason: string | null;
  pendingLifecycle: 'pause' | 'resume' | null;
  refreshRequired: boolean;
  onToggleLifecycle: (
    definition: MessageDigestDefinition,
    activation?: MessageDigestLifecycleActivation
  ) => void;
  onRun: (definition: MessageDigestDefinition) => void;
  onDelete: (definition: MessageDigestDefinition) => void;
}

const MENU_ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500';
const MENU_WIDTH_PX = 256;
const MENU_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

export function MessageDigestActionsMenu({
  definition,
  runDisabledReason,
  lifecycleDisabledReason,
  deleteDisabledReason,
  pendingLifecycle,
  refreshRequired,
  onToggleLifecycle,
  onRun,
  onDelete,
}: MessageDigestActionsMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeMenuItemId, setActiveMenuItemId] = useState('view');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLAnchorElement | null>(null);
  const returnFocusAfterLifecycleRef = useRef(false);
  const lifecyclePendingObservedRef = useRef(false);
  const menuId = useId();
  const deleting = definition.status === 'deleting';
  const lifecycleAction = definition.status === 'paused' ? 'resume' : 'pause';
  const lifecycleLabel = lifecycleAction === 'pause' ? 'Pause digest' : 'Resume digest';
  const lifecycleBlocked = lifecycleAction === 'resume' && lifecycleDisabledReason !== null;
  const lifecycleReasonId = `${menuId}-lifecycle-reason`;
  const deleteReasonId = `${menuId}-delete-reason`;
  const pendingLabel =
    refreshRequired
      ? `Refresh required for ${definition.name}`
      : pendingLifecycle === 'pause'
      ? `Pausing ${definition.name}…`
      : pendingLifecycle === 'resume'
        ? `Resuming ${definition.name}…`
        : `Actions for ${definition.name}`;

  const updateMenuPosition = useCallback((): void => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (trigger === null || menu === null) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width > 0 ? menuRect.width : MENU_WIDTH_PX;
    const menuHeight = menuRect.height;
    const belowTop = triggerRect.bottom + MENU_GAP_PX;
    const aboveTop = triggerRect.top - MENU_GAP_PX - menuHeight;
    const fitsBelow = belowTop + menuHeight <= window.innerHeight - VIEWPORT_MARGIN_PX;
    const fitsAbove = aboveTop >= VIEWPORT_MARGIN_PX;
    const preferredTop = !fitsBelow && fitsAbove ? aboveTop : belowTop;
    const maxTop = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - menuHeight - VIEWPORT_MARGIN_PX);
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - menuWidth - VIEWPORT_MARGIN_PX);
    menu.style.top = `${String(clamp(preferredTop, VIEWPORT_MARGIN_PX, maxTop))}px`;
    menu.style.left = `${String(
      clamp(triggerRect.right - menuWidth, VIEWPORT_MARGIN_PX, maxLeft)
    )}px`;
    menu.classList.remove('invisible');
  }, []);

  useEffect(() => {
    if (pendingLifecycle !== null || refreshRequired) setOpen(false);
  }, [pendingLifecycle, refreshRequired]);

  useEffect(() => {
    if (!returnFocusAfterLifecycleRef.current) return;
    if (pendingLifecycle !== null) {
      lifecyclePendingObservedRef.current = true;
      return;
    }
    if (!lifecyclePendingObservedRef.current || refreshRequired) return;
    returnFocusAfterLifecycleRef.current = false;
    lifecyclePendingObservedRef.current = false;
    const focusTimer = window.setTimeout(() => triggerRef.current?.focus(), 0);
    return (): void => {
      window.clearTimeout(focusTimer);
    };
  }, [pendingLifecycle, refreshRequired]);

  useEffect(() => {
    if (!open) return;
    setActiveMenuItemId('view');
    const focusTimer = window.setTimeout(() => firstItemRef.current?.focus(), 0);
    const closeOnOutsideClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) !== true &&
        menuRef.current?.contains(target) !== true
      ) {
        setOpen(false);
        window.setTimeout(() => triggerRef.current?.focus(), 0);
      }
    };
    const closeOnOutsideFocus = (event: FocusEvent): void => {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) !== true &&
        menuRef.current?.contains(target) !== true
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('focusin', closeOnOutsideFocus);
    return (): void => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('focusin', closeOnOutsideFocus);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return (): void => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [
    deleteDisabledReason,
    definition.status,
    lifecycleDisabledReason,
    open,
    runDisabledReason,
    updateMenuPosition,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative shrink-0"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={pendingLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={pendingLifecycle !== null || refreshRequired}
        onClick={(): void => {
          setOpen((current) => !current);
        }}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50"
      >
        {pendingLifecycle === null ? (
          <EllipsisVertical aria-hidden="true" className="h-5 w-5" />
        ) : (
          <LoaderCircle
            aria-hidden="true"
            className="h-5 w-5 animate-spin motion-reduce:animate-none"
          />
        )}
      </button>

      {open
        ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          onKeyDown={(event): void => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === 'Tab') {
              setOpen(false);
            } else if (
              event.key === 'ArrowDown' ||
              event.key === 'ArrowUp' ||
              event.key === 'Home' ||
              event.key === 'End'
            ) {
              event.preventDefault();
              const enabledItems = getEnabledMenuItems(menuRef.current);
              if (enabledItems.length === 0) return;
              const currentIndex = enabledItems.findIndex(
                (item) => item === document.activeElement
              );
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? enabledItems.length - 1
                    : event.key === 'ArrowDown'
                      ? (Math.max(currentIndex, -1) + 1) % enabledItems.length
                      : currentIndex <= 0
                        ? enabledItems.length - 1
                        : currentIndex - 1;
              const nextItem = enabledItems[nextIndex];
              if (nextItem !== undefined) {
                const nextItemId = nextItem.dataset['menuItemId'];
                if (nextItemId !== undefined) setActiveMenuItemId(nextItemId);
                nextItem.focus();
              }
            }
          }}
          onFocusCapture={(event): void => {
            const menuItemId = (event.target as HTMLElement).dataset['menuItemId'];
            if (menuItemId !== undefined) setActiveMenuItemId(menuItemId);
          }}
          className="invisible fixed z-30 max-h-[calc(100dvh-1rem)] w-64 max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          <Link
            ref={firstItemRef}
            role="menuitem"
            data-menu-item-id="view"
            tabIndex={activeMenuItemId === 'view' ? 0 : -1}
            to={`/whatsapp/message-digests/${definition.id}`}
            className={`${MENU_ITEM_CLASS} text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700`}
          >
            <Eye aria-hidden="true" className="h-4 w-4" />
            View details
          </Link>
          {deleting ? (
            <DisabledMenuItem
              menuItemId="edit"
              icon={<Edit3 aria-hidden="true" className="h-4 w-4" />}
            >
              Edit
            </DisabledMenuItem>
          ) : (
            <Link
              role="menuitem"
              data-menu-item-id="edit"
              tabIndex={activeMenuItemId === 'edit' ? 0 : -1}
              to={`/whatsapp/message-digests/${definition.id}/edit`}
              className={`${MENU_ITEM_CLASS} text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700`}
            >
              <Edit3 aria-hidden="true" className="h-4 w-4" />
              Edit
            </Link>
          )}
          {runDisabledReason === null && !deleting ? (
            <button
              type="button"
              role="menuitem"
              data-menu-item-id="run"
              tabIndex={activeMenuItemId === 'run' ? 0 : -1}
              onClick={(): void => {
                setOpen(false);
                onRun(definition);
              }}
              className={`${MENU_ITEM_CLASS} text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700`}
            >
              <Play aria-hidden="true" className="h-4 w-4" />
              Run now
            </button>
          ) : (
            <div>
              <DisabledMenuItem
                menuItemId="run"
                icon={<Play aria-hidden="true" className="h-4 w-4" />}
              >
                Run now
              </DisabledMenuItem>
              <p className="px-3 pb-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                {runDisabledReason ?? 'Deletion is already in progress.'}
              </p>
            </div>
          )}
          {deleting || lifecycleBlocked ? (
            <div>
              <DisabledMenuItem
                menuItemId="lifecycle"
                descriptionId={lifecycleBlocked ? lifecycleReasonId : undefined}
                icon={
                  lifecycleAction === 'pause' ? (
                    <PauseCircle aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <PlayCircle aria-hidden="true" className="h-4 w-4" />
                  )
                }
              >
                {lifecycleLabel}
              </DisabledMenuItem>
              {lifecycleBlocked ? (
                <p
                  id={lifecycleReasonId}
                  className="px-3 pb-2 text-xs leading-5 text-amber-700 dark:text-amber-300"
                >
                  {lifecycleDisabledReason}
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              data-menu-item-id="lifecycle"
              tabIndex={activeMenuItemId === 'lifecycle' ? 0 : -1}
              onClick={(event): void => {
                const activation: MessageDigestLifecycleActivation =
                  event.detail === 0 ? 'keyboard' : 'pointer';
                if (activation === 'keyboard') {
                  returnFocusAfterLifecycleRef.current = true;
                  lifecyclePendingObservedRef.current = false;
                }
                setOpen(false);
                onToggleLifecycle(definition, activation);
              }}
              className={`${MENU_ITEM_CLASS} text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700`}
            >
              {lifecycleAction === 'pause' ? (
                <PauseCircle aria-hidden="true" className="h-4 w-4" />
              ) : (
                <PlayCircle aria-hidden="true" className="h-4 w-4" />
              )}
              {lifecycleLabel}
            </button>
          )}
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
          {deleteDisabledReason !== null ? (
            <div>
              <DisabledMenuItem
                menuItemId="delete"
                descriptionId={deleteReasonId}
                icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
              >
                Delete digest
              </DisabledMenuItem>
              <p
                id={deleteReasonId}
                className="px-3 pb-2 text-xs leading-5 text-amber-700 dark:text-amber-300"
              >
                {deleteDisabledReason}
              </p>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              data-menu-item-id="delete"
              tabIndex={!deleting && activeMenuItemId === 'delete' ? 0 : -1}
              disabled={deleting}
              onClick={(): void => {
                setOpen(false);
                onDelete(definition);
              }}
              className={`${MENU_ITEM_CLASS} text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40`}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Delete digest
            </button>
          )}
        </div>,
        document.body
          )
        : null}
    </div>
  );
}

function DisabledMenuItem({
  menuItemId,
  descriptionId,
  icon,
  children,
}: {
  menuItemId: string;
  descriptionId?: string | undefined;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item-id={menuItemId}
      tabIndex={-1}
      aria-describedby={descriptionId}
      disabled
      className={`${MENU_ITEM_CLASS} cursor-not-allowed text-slate-400 dark:text-slate-500`}
    >
      {icon}
      {children}
    </button>
  );
}

function getEnabledMenuItems(menu: HTMLDivElement | null): HTMLElement[] {
  if (menu === null) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (item) => !(item instanceof HTMLButtonElement && item.disabled)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
