import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port:  3000,
    host:  '0.0.0.0',
    open:  false,
    // B13-FIX: removido proxy para :3001 (servidor Express não existe no projecto)
    // Se precisares de proxy para proteger chaves API, adiciona um server.ts
    // e activa abaixo:
    // proxy: {
    //   '/api': { target: 'http://localhost:3001', changeOrigin: true },
    // },
  },

  build: {
    outDir:        'dist',
    sourcemap:     false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },

  optimizeDeps: {
    include: ['react', 'react-dom', 'three'],
  },

  define: {
    __APP_VERSION__: JSON.stringify('3.1.0'),
  },
});
