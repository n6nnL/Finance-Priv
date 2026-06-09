import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev үед '/api' ба '/health'-г Express API (3000) руу proxy хийнэ → CORS хэрэггүй.
// Production-д build хийгээд API нь dashboard/dist-г static-аар serve хийдэг (нэг origin).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
