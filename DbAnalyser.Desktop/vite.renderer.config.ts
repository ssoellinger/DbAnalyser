import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    // Disable auto-discovery to avoid esbuild dep-scan race condition
    // (known issue with paths containing spaces)
    noDiscovery: true,
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom/client',
      'react-router-dom',
      'zustand',
      '@xyflow/react',
      '@dagrejs/dagre',
      '@tanstack/react-table',
      '@microsoft/signalr',
    ],
  },
});
