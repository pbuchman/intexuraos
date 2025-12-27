import type { ReactNode } from 'react';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <Sidebar />
      {/* Main content - no left margin on mobile, margin on desktop */}
      <main className="pt-16 transition-all duration-300 md:ml-64">
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
