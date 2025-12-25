import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageCircle,
  FileText,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/notion', label: 'Notion Connection', icon: FileText },
  { to: '/whatsapp', label: 'WhatsApp Connection', icon: MessageCircle },
  { to: '/whatsapp-notes', label: 'WhatsApp Notes', icon: MessageSquare },
];

export function Sidebar(): React.JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside
      className={`fixed bottom-0 left-0 top-16 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>{item.label}</span> : null}
          </NavLink>
        ))}
      </nav>

      <button
        onClick={() => {
          setIsCollapsed(!isCollapsed);
        }}
        className="flex items-center justify-center border-t border-slate-200 p-3 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
      </button>
    </aside>
  );
}
