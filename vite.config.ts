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
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
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
