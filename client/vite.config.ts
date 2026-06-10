import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { vitePrerenderPlugin } from 'vite-prerender-plugin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// (D11) Upload de sourcemaps ao Sentry só quando há token configurado (CI/prod).
// Sem token, geramos os mapas em modo 'hidden' (não referenciados no bundle) e os
// REMOVEMOS do dist público via plugin abaixo — nunca expostos ao usuário final.
const sentryUploadEnabled = !!process.env.SENTRY_AUTH_TOKEN;

// Fallback dependency-free: apaga os .map do dist público quando não há upload.
const stripPublicSourcemaps = () => ({
  name: 'strip-public-sourcemaps',
  apply: 'build' as const,
  closeBundle() {
    if (sentryUploadEnabled) return; // o plugin do Sentry já deleta após o upload
    const distDir = path.resolve(__dirname, 'dist');
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.map')) fs.rmSync(full);
      }
    };
    walk(distDir);
  },
});

// Configuração para build de produção e testes
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Não cria SW em `vite dev` (evita cache atrapalhar o HMR/desktop em desenvolvimento).
      devOptions: { enabled: false },
      includeAssets: ['icons/apple-touch-icon.png', 'og-image.png'],
      manifest: {
        name: 'Vértice Invest',
        short_name: 'Vértice',
        description:
          'Análise quantitativa de Ações, FIIs e Cripto com rankings, sinais técnicos e carteira inteligente.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#2563EB',
        background_color: '#080C14',
        lang: 'pt-BR',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // (D11) Não gera sourcemap do service worker (evita .map público do SW).
        sourcemap: false,
        // Precache do shell do app (assets do build).
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        // Nunca interceptar /api no fallback de navegação (são respostas de API, não páginas).
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // skipWaiting + clientsClaim + registerType:'autoUpdate' = o novo SW assume
        // imediatamente e a página recarrega sozinha, sem o usuário precisar dar refresh.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Auth e escrita: SEMPRE rede, nunca cache (dados sensíveis / mutações).
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api/') &&
              (request.method !== 'GET' ||
                /\/api\/(login|register|logout|refresh|forgot-password|reset-password)/.test(url.pathname)),
            handler: 'NetworkOnly',
          },
          {
            // Demais GETs de API: rede primeiro, cache como fallback offline (curta validade).
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Fontes Google.
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Imagens estáticas.
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
    // (D11) Upload de sourcemaps ao Sentry (apaga os .map do dist após o upload).
    // Só ativa com SENTRY_AUTH_TOKEN — builds locais/sem token não dependem dele.
    ...(sentryUploadEnabled
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          telemetry: false,
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        })]
      : []),
    ...vitePrerenderPlugin({
      prerenderScript: path.resolve(__dirname, 'src/prerender.tsx'),
      renderTarget: '#root',
    }),
    stripPublicSourcemaps(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false, // Permite fallback se a porta estiver ocupada
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
    outDir: 'dist',
    emptyOutDir: true,
    // (D11) 'hidden': gera os .map mas NÃO adiciona o comentário sourceMappingURL
    // no bundle — não são anunciados ao browser. São enviados ao Sentry e/ou
    // removidos do dist público (ver plugins acima).
    sourcemap: 'hidden'
  },
  // Configuração do Vitest integrada
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['node_modules', 'dist']
  }
});