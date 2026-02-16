import { Link, Outlet, useLocation } from 'react-router';
import { CheckSquare, GitBranch, Server, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

const tabs: TabItem[] = [
  {
    id: 'tasks',
    label: 'Tasks',
    icon: CheckSquare,
    path: '/',
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
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);

  const isTabActive = (tabPath: string) => {
    if (tabPath === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(tabPath);
  };

  return (
    <div className="flex flex-col h-screen md:hidden">
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50">
        {/* Gradient overlay to prevent content from being hidden */}
        <div className="h-20 bg-gradient-to-t from-background to-transparent pointer-events-none" />

        {/* Tab bar container */}
        <div className="flex justify-center px-4 pb-6">
          <nav className="flex items-center justify-around rounded-full bg-card h-[62px] shadow-2xl border border-border/40 w-full max-w-sm px-1">
            {tabs.slice(0, 2).map((tab) => {
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

            {/* Search button in center */}
            <button
              onClick={() => setCommandPaletteOpen(true)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 h-full rounded-full transition-colors',
                'hover:bg-accent/50'
              )}
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                <Search className="h-5 w-5 text-primary" />
              </div>
            </button>

            {tabs.slice(2).map((tab) => {
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
