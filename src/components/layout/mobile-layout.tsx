import { Link, Outlet, useLocation } from 'react-router';
import { LayoutDashboard, Sparkles, GitBranch, Server, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

const tabs: TabItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    path: '/dashboard',
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: Sparkles,
    path: '/plan',
  },
  {
    id: 'playground',
    label: 'Playground',
    icon: FlaskConical,
    path: '/playground',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: GitBranch,
    path: '/projects',
  },
  {
    id: 'environments',
    label: 'Envs',
    icon: Server,
    path: '/environments',
  },
];

export function MobileLayout() {
  const location = useLocation();

  const isTabActive = (tabPath: string) => {
    if (tabPath === '/dashboard') {
      return location.pathname === '/' || location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(tabPath);
  };

  return (
    <div
      className="flex flex-col md:hidden"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        // Shrink by keyboard height so flex children (including bottom inputs) stay visible
        height: 'calc(100dvh - var(--keyboard-height, 0px))',
      }}
    >
      <main className="mobile-main-content flex-1 overflow-y-auto min-h-0">
        <Outlet />
      </main>

      {/* Tab bar — in-flow so main content naturally stops above it */}
      <div className="mobile-tab-bar shrink-0 flex justify-center px-4 bg-background" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
        <nav className="flex items-center justify-around rounded-full bg-card h-[56px] shadow-2xl border border-border/40 w-full max-w-md px-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = isTabActive(tab.path);

            return (
              <Link
                key={tab.id}
                to={tab.path}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-full transition-colors',
                  'hover:bg-accent/50'
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )}
                />
                <span
                  className={cn(
                    'text-[9px]',
                    isActive ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
