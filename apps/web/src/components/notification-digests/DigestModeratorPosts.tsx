/**
 * Vertical timeline of moderator posts for the day, with HH:MM markers
 * on the left.
 */

import { Megaphone } from 'lucide-react';
import { Card } from '@/components';
import type { DigestModeratorPost } from '@/types/notificationDigests';

interface DigestModeratorPostsProps {
  readonly posts: readonly DigestModeratorPost[];
}

export function DigestModeratorPosts({
  posts,
}: DigestModeratorPostsProps): React.JSX.Element | null {
  if (posts.length === 0) return null;
  return (
    <Card className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
        <Megaphone className="h-5 w-5 text-violet-500" />
        Moderator posts ({String(posts.length)})
      </h3>
      <ol className="relative space-y-4 border-l border-slate-200 pl-6 dark:border-slate-700">
        {posts.map((post, i) => (
          <li key={`${String(i)}-${post.time}`} className="relative">
            <span className="absolute -left-[26px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 ring-4 ring-white dark:ring-slate-800" />
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400">
                {post.time}
              </span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {post.topic}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{post.summary}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
