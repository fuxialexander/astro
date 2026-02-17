import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true, // Allow external access via cloudflared tunnel
    allowedHosts: ['nexus.fuxialexander.work', '.fuxialexander.work'],
    hmr: {
      protocol: 'wss',
      host: 'nexus.fuxialexander.work',
      clientPort: 443,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    cors: true,
  },
  optimizeDeps: {
    // Pre-bundle all dependencies to reduce concurrent requests
    include: ['react', 'react-dom', 'react-router', 'zustand', '@simplewebauthn/browser'],
  },
})
