import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { MobileNotification } from '@/types';
import { formatRelative } from '@/utils/dateFormat';
import { Badge } from './shared.js';

interface NotificationCardProps {
  notification: MobileNotification;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

/**
 * Individual notification card styled as compact row with R4 pattern.
 * Desktop grid: Device badge | App badge | Content preview | Source badge | Time | Actions
 */
export function NotificationCard({
  notification,
  onDelete,
  isDeleting,
}: NotificationCardProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const relativeTime = formatRelative(notification.receivedAt);

  return (
    <div
      className={`group relative rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-all duration-300 dark:border-slate-700 dark:bg-slate-800 ${
        isDeleting ? 'scale-95 opacity-50' : 'hover:shadow-md dark:hover:border-slate-600'
      }`}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_auto_1fr_auto_140px_60px] md:items-center md:gap-2">
        <div className="flex min-w-0 items-start justify-between gap-3 md:contents">
          <div className="min-w-0 md:order-3">
            <p className="line-clamp-2 break-words font-medium text-slate-900 dark:text-slate-100 md:truncate">
              {notification.title}
            </p>
            {notification.text !== '' ? (
              <p className="mt-1 line-clamp-2 break-words text-xs text-slate-500 dark:text-slate-400 md:mt-0 md:truncate">
                {notification.text}
              </p>
            ) : null}
          </div>

          <div className="flex items-start justify-end md:order-6">
            <button
              onClick={(e): void => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              disabled={isDeleting}
              className="rounded p-1 text-slate-400 opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100"
              aria-label="Delete notification"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 md:contents">
          <Badge className="w-fit md:order-1">{notification.device}</Badge>
          <Badge
            className="max-w-full truncate md:order-2 md:max-w-[14rem]"
            title={notification.app}
          >
            {notification.app}
          </Badge>
          <Badge className="w-fit md:order-4">{notification.source}</Badge>
        </div>

        <span className="text-xs text-slate-400 dark:text-slate-500 md:order-5">
          {relativeTime}
        </span>
      </div>

      {/* R5 overlay delete */}
      {showDeleteConfirm ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200">Delete this notification?</p>
            <button
              onClick={(e): void => {
                e.stopPropagation();
                setShowDeleteConfirm(false);
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={(e): void => {
                e.stopPropagation();
                setShowDeleteConfirm(false);
                onDelete(notification.id);
              }}
              disabled={isDeleting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
