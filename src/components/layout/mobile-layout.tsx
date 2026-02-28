import { Link, Outlet, useLocation } from 'react-router';
import { LayoutDashboard, Sparkles, GitBranch, Server } from 'lucide-react';
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
    <div className="flex flex-col h-dvh md:hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50">
        {/* Gradient overlay — sits behind tab bar, fades content into bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none" />

        {/* Tab bar container */}
        <div className="relative flex justify-center px-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
          <nav className="flex items-center justify-around rounded-full bg-card h-[62px] shadow-2xl border border-border/40 w-full max-w-sm px-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = isTabActive(tab.path);

              return (
                <Link
                  key={tab.id}
                  to={tab.path}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 flex-1 h-full rounded-full transition-colors',
                    'hover:bg-accent/50'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-6 w-6',
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  />
                  <span
                    className={cn(
                      'text-[10px]',
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
    </div>
  );
}
