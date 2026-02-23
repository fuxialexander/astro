// Re-export all core types
export * from '@astro/core/types'
import type { CommandCategory } from '@astro/core/types'

// Re-export server types that were previously re-exported here
export type {
  GitHubRepo,
  GitHubUser,
  GitHubConnection,
  GitHubRepoSelection,
} from '../../server/types/github';

export type {
  RegisteredMachine,
} from '../../server/types/device-auth';

// ─── UI-specific types (React-dependent) ──────────────────────────────

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  category: CommandCategory;
  keywords?: string[];
  shortcut?: string;
  action?: () => void | Promise<void>;
  children?: CommandItem[];
  preview?: {
    title: string;
    content: string;
    metadata?: Record<string, string>;
  };
  metadata?: Record<string, unknown>;
}

export interface CommandContext {
  breadcrumbs: CommandItem[];
  selectedItems: string[];
  searchQuery: string;
}
