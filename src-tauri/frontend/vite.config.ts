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
        { find: '@desktop', replacement: path.resolve(__dirname, './src') },
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
