import { ExternalLink, GitCommit, Calendar, Tag, X } from 'lucide-react';
import { Modal } from './ui/Modal.js';

interface VersionInfoModalProps {
  onClose: () => void;
}

const GITHUB_REPO_URL = 'https://github.com/pbuchman/intexuraos';
const UNKNOWN_VALUE = 'unknown';

function getBuildValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function formatBuildDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown build date' : date.toLocaleString();
}

export function VersionInfoModal({ onClose }: VersionInfoModalProps): React.JSX.Element {
  const version = getBuildValue(import.meta.env.INTEXURAOS_BUILD_VERSION, 'Unknown version');
  const commitSha = getBuildValue(import.meta.env.INTEXURAOS_COMMIT_SHA, UNKNOWN_VALUE);
  const commitMessage = getBuildValue(import.meta.env.INTEXURAOS_COMMIT_MESSAGE, 'Unknown commit');
  const buildDate = getBuildValue(import.meta.env.INTEXURAOS_BUILD_DATE, UNKNOWN_VALUE);

  const hasCommitSha = commitSha !== UNKNOWN_VALUE;
  const shortSha = hasCommitSha ? commitSha.slice(0, 7) : UNKNOWN_VALUE;
  const commitUrl = `${GITHUB_REPO_URL}/commit/${commitSha}`;
  const formattedDate = formatBuildDate(buildDate);

  return (
    <Modal
      open
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title="Version Information"
      hideTitle
      padded={false}
      overlayClassName="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-2xl dark:bg-slate-800"
    >
      <button
        onClick={onClose}
        className="absolute right-3 top-3 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo.png" alt="IntexuraOS Logo" className="h-10 w-10" />
          <div>
            <h2 className="text-xl font-bold">
              <span className="text-cyan-500">Intexura</span>
              <span className="text-slate-900 dark:text-slate-100">OS</span>
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Version Information</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Tag className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" />
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Version</p>
              <p className="font-mono text-slate-900 dark:text-slate-100">{version}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <GitCommit className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Last Commit</p>
              <p className="truncate text-slate-900 dark:text-slate-100" title={commitMessage}>
                {commitMessage}
              </p>
              {hasCommitSha ? (
                <a
                  href={commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 font-mono text-sm text-blue-600 hover:underline dark:text-blue-400"
                >
                  {shortSha}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <p className="mt-1 font-mono text-sm text-slate-500 dark:text-slate-400">
                  {shortSha}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" />
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Build Date</p>
              <p className="text-slate-900 dark:text-slate-100">{formattedDate}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-700">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            View on GitHub
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </Modal>
  );
}
