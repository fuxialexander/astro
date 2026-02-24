import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
  plugins: [
    {
      name: 'landing-page-rewrite',
      configureServer(server) {
        // Rewrite /landing/ to /landing/index.html before Vite's SPA fallback intercepts it
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/landing' || req.url === '/landing/') {
            req.url = '/landing/index.html'
          } else if (req.url === '/landing/about' || req.url === '/landing/about/') {
            req.url = '/landing/about.html'
          }
          next()
        })
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      // @astro/core subpath imports (must come before bare @astro/core)
      { find: /^@astro\/core\/(.+)$/, replacement: path.resolve(__dirname, './packages/core/src/$1') },
      // @astro/core bare import
      { find: /^@astro\/core$/, replacement: path.resolve(__dirname, './packages/core/src/index.ts') },
      // src alias (must come after @astro/core to avoid matching @astro)
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  server: {
    watch: {
      ignored: ['**/.astro/worktrees/**', '**/.claude/worktrees/**'],
    },
    host: true,
    allowedHosts: env.ALLOWED_HOSTS?.split(',') || true,
    hmr: env.VITE_HMR_PROTOCOL ? {
      protocol: env.VITE_HMR_PROTOCOL as 'ws' | 'wss',
      host: env.VITE_HMR_HOST || 'localhost',
      clientPort: env.VITE_HMR_PORT ? parseInt(env.VITE_HMR_PORT) : undefined,
    } : undefined,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if ('code' in err && (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
              try {
                const sres = res as import('http').ServerResponse
                if (sres && 'writeHead' in sres && !sres.headersSent && !sres.writableEnded) {
                  sres.writeHead(503, { 'Content-Type': 'text/plain' })
                  sres.end('Backend starting...')
                }
              } catch {
                // Socket may already be destroyed — nothing to do
              }
            }
          })
        },
      },
    },
    cors: true,
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/app.tsx',
        './src/globals.css',
        './src/pages/login.tsx',
        './src/pages/dashboard.tsx',
        './src/pages/projects.tsx',
        './src/pages/plan-view.tsx',
        './src/pages/my-tasks.tsx',
        './src/pages/project-overview.tsx',
        './src/pages/task-detail.tsx',
        './src/pages/environments.tsx',
        './src/components/layout/sidebar.tsx',
        './src/components/layout/app-layout.tsx',
        './src/components/plan-graph/plan-canvas.tsx',
      ],
    },
  },
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-router', 'zustand',
      '@simplewebauthn/browser', 'lucide-react', '@xyflow/react',
      'idb-keyval', 'cmdk', '@supabase/supabase-js',
    ],
  },
  }
})
