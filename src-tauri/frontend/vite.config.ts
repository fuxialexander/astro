import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        // Tauri-specific shims — must come before @/ so they override web-app modules
        { find: /^@\/lib\/supabase-client$/, replacement: path.resolve(__dirname, './src/shims/supabase-client.ts') },
        { find: /^@\/lib\/api-url$/, replacement: path.resolve(__dirname, './src/shims/api-url.ts') },
        { find: /^@\/lib\/app-mode$/, replacement: path.resolve(__dirname, './src/shims/app-mode.ts') },
        // Desktop-specific code
        { find: '@desktop', replacement: path.resolve(__dirname, './src') },
        // Main web-app source — enables importing web components directly
        { find: /^@\/(.*)/, replacement: path.resolve(__dirname, '../../src/$1') },
      ],
    },
    server: {
      port: 5174,
      strictPort: true,
    },
    // Use relative paths for Tauri (file:// protocol)
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Production source maps for debugging
      sourcemap: isProd ? 'hidden' : true,
      // Minification
      minify: isProd ? 'esbuild' : false,
      // Target modern browsers (Tauri uses system WebView)
      target: 'esnext',
      // Chunk splitting for better caching
      rollupOptions: {
        output: {
          manualChunks: {
            // Vendor chunks for better caching
            'vendor-react': ['react', 'react-dom', 'react-router'],
            'vendor-xyflow': ['@xyflow/react'],
            'vendor-ui': ['cmdk', 'lucide-react', 'framer-motion'],
            'vendor-zustand': ['zustand'],
          },
        },
      },
      // Increase chunk size warning limit for desktop app
      chunkSizeWarningLimit: 1000,
      // Enable CSS code splitting
      cssCodeSplit: true,
    },
    // Prevent Vite from obscuring Rust errors in Tauri dev
    clearScreen: false,
    // Optimize deps for faster dev startup
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router', 'zustand', '@xyflow/react'],
    },
  }
})
