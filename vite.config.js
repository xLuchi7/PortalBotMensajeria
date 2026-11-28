import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El frontend vive en client/ y se compila a client/dist, que sirve Express
// (index.js). En desarrollo, `npm run dev:client` levanta Vite en :5173 y le
// pasa /api y /shopify al servidor de Node (`npm run dev`, puerto PORT o 3100).
const API = `http://localhost:${process.env.PORT || 3100}`;

export default defineConfig({
  root: 'client',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/shopify': API,
      '/meta/callback': API,
      '/mercadopago/callback': API,
      '/plantillas': API,
      '/favicon.svg': API,
    },
  },
});
