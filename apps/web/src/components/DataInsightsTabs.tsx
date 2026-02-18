import { Link, useLocation } from 'react-router-dom';
import { Layers, Database, BarChart2 } from 'lucide-react';

export function DataInsightsTabs(): React.JSX.Element {
  const location = useLocation();
  const currentPath = location.pathname;

  const activeClass = 'border-b-2 border-blue-500 px-1 py-4 text-sm font-medium text-blue-600 dark:text-blue-400';
  const inactiveClass =
    'border-b-2 border-transparent px-1 py-4 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300';

  const isCompositeFeeds =
    currentPath === '/data-insights' || (currentPath.startsWith('/data-insights/') && !currentPath.startsWith('/data-insights/static-sources') && !currentPath.startsWith('/data-insights/visualizations'));
  const isStaticSources = currentPath.startsWith('/data-insights/static-sources');
  const isVisualizations = currentPath.startsWith('/data-insights/visualizations');

  return (
    <div className="mb-6 border-b border-slate-200 dark:border-slate-700">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        <Link to="/data-insights" className={isCompositeFeeds ? activeClass : inactiveClass}>
          <Layers className="mr-2 inline h-4 w-4" />
          Composite Feeds
        </Link>
        <Link to="/data-insights/static-sources" className={isStaticSources ? activeClass : inactiveClass}>
          <Database className="mr-2 inline h-4 w-4" />
          Static Sources
        </Link>
        <Link to="/data-insights/visualizations" className={isVisualizations ? activeClass : inactiveClass}>
          <BarChart2 className="mr-2 inline h-4 w-4" />
          Visualizations
        </Link>
      </nav>
    </div>
  );
}
