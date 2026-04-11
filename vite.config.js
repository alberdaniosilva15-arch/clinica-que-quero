import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',

  server: {
    port: 3000,
    host: '0.0.0.0',
    open: '/login.html',
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },

  optimizeDeps: {
    include: ['react', 'react-dom', 'three', '@supabase/supabase-js'],
  },

  define: {
    __APP_VERSION__: JSON.stringify('3.2.0'),
  },
});