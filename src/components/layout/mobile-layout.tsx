import { Link, Outlet, useLocation } from 'react-router';
import { LayoutDashboard, Sparkles, GitBranch, Server, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface TabItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

const tabs: TabItem[] = [
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    path: '/dashboard',
  },
  {
    id: 'home',
    icon: Sparkles,
    path: '/dashboard',
  },
  {
    id: 'projects',
    icon: GitBranch,
    path: '/projects',
  },
  {
    id: 'environments',
    icon: Server,
    path: '/environments',
  },
  {
    id: 'settings',
    icon: Settings,
    path: '/settings',
  },
];

export function MobileTabBar() {
  const { t } = useTranslation('nav');
  const location = useLocation();

  const isTabActive = (tabPath: string) => {
    if (tabPath === '/dashboard') {
      return location.pathname === '/' || location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(tabPath);
  };

  return (
    <div
      className="md:hidden mobile-tab-bar fixed left-0 right-0 z-50 flex justify-center px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
    >
      <nav className="flex items-center justify-around rounded-full bg-card/90 backdrop-blur-lg h-[56px] shadow-2xl border border-border/40 w-full max-w-md px-1">
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
                {t(tab.id, { defaultValue: tab.id })}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function MobileLayout() {
  return (
    <div
      className="md:hidden min-h-dvh bg-background"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <main className="mobile-main-content pb-20">
        <Outlet />
      </main>

      <MobileTabBar />
    </div>
  );
}
