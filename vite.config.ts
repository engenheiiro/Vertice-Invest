import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuração para build de produção
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy para desenvolvimento local: redireciona chamadas /api para o backend
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    outDir: 'dist', // Pasta que o Render vai servir
    emptyOutDir: true,
    sourcemap: false
  }
});