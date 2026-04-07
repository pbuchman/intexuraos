import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, Layout } from '@/components';
import { HellscriptBufferRow } from '@/components/hellscript/index.js';
import { useHellscriptBuffers } from '@/hooks';

export function HellscriptBuffersPage(): React.JSX.Element {
  const { buffers, loading, error } = useHellscriptBuffers();

  return (
    <Layout>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Infernal Whispers
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {String(buffers.length)} whisper{buffers.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link to="/hellscript/new">
            <Button>
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Summon</span>
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : error !== null ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : buffers.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No whispers yet. Summon a new session to begin.
            </p>
            <Link
              to="/hellscript/new"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Summon
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {buffers.map((buffer) => (
              <HellscriptBufferRow key={buffer.id} buffer={buffer} />
            ))}
          </div>
        )}
    </Layout>
  );
}
