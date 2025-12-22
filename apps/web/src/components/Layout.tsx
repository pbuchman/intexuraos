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
      <main className="ml-64 pt-16 transition-all duration-300">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
