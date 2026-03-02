import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.astro/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@astro/core/dispatch': path.resolve(__dirname, './packages/core/src/dispatch/index.ts'),
      '@astro/core/db/schema': path.resolve(__dirname, './packages/core/src/db/schema.ts'),
      '@astro/core/db/migrate': path.resolve(__dirname, './packages/core/src/db/migrate.ts'),
      '@astro/core/db': path.resolve(__dirname, './packages/core/src/db/index.ts'),
      '@astro/core/types': path.resolve(__dirname, './packages/core/src/types.ts'),
      '@astro/core/prompt-templates': path.resolve(__dirname, './packages/core/src/prompt-templates.ts'),
      '@astro/core/app-mode': path.resolve(__dirname, './packages/core/src/app-mode.ts'),
      '@astro/core/error-utils': path.resolve(__dirname, './packages/core/src/error-utils.ts'),
      '@astro/core/git-url-utils': path.resolve(__dirname, './packages/core/src/git-url-utils.ts'),
      '@astro/core/skill-injector': path.resolve(__dirname, './packages/core/src/skill-injector.ts'),
      '@astro/core/skill-parser': path.resolve(__dirname, './packages/core/src/skill-parser.ts'),
      '@astro/core': path.resolve(__dirname, './packages/core/src/index.ts'),
    },
  },
})
