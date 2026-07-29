import { LoaderCircle, Newspaper } from 'lucide-react';
import { Layout } from '@/components/Layout';

interface MessageDigestPageLoadingProps {
  title: string;
  message?: string;
}

export function MessageDigestPageLoading({
  title,
  message = 'Loading Message Digests…',
}: MessageDigestPageLoadingProps): React.JSX.Element {
  return (
    <Layout>
      <section
        className="mx-auto flex w-full max-w-6xl flex-col gap-6"
        aria-labelledby="page-title"
      >
        <header className="border-b border-slate-200 pb-5 dark:border-slate-800">
          <h1
            id="page-title"
            className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-slate-50"
          >
            <Newspaper aria-hidden="true" className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            {title}
          </h1>
        </header>
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-48 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <LoaderCircle
            aria-hidden="true"
            className="h-5 w-5 animate-spin text-blue-600 motion-reduce:animate-none"
          />
          <span>{message}</span>
        </div>
      </section>
    </Layout>
  );
}
