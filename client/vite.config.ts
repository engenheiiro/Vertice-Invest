import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { vitePrerenderPlugin } from 'vite-prerender-plugin';
import { visualizer } from 'rollup-plugin-visualizer';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
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
    // (5.6) Otimização de imagens no build (sharp/svgo): comprime PNG/JPG/SVG do
    // bundle e do /public — incl. og-image.png (827KB → bem menor). Só roda em
    // `vite build` (apply:'build' interno), não afeta o dev/HMR.
    ViteImageOptimizer({
      // Screenshot do dashboard contém textos pequenos. Preservamos os bytes originais
      // para evitar artefatos de compressão no hero da landing.
      exclude: /hero-dashboard\.png$/,
      png: { quality: 80 },
      jpeg: { quality: 80 },
      jpg: { quality: 80 },
      webp: { quality: 80 },
      avif: { quality: 70 },
    }),
    VitePWA({
      // 'prompt' (não 'autoUpdate'): ao detectar novo build, o virtual module marca
      // needRefresh=true → o <ReloadPrompt> aplica o SW e recarrega a página. Em
      // 'autoUpdate' o needRefresh nunca dispara e a aba aberta ficava presa no build
      // antigo até o usuário navegar várias vezes (logout/login repetidos).
      registerType: 'prompt',
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
        // SEM skipWaiting/clientsClaim: no fluxo 'prompt' o SW novo fica em "waiting"
        // até o <ReloadPrompt> chamar updateServiceWorker(true), que envia SKIP_WAITING
        // e recarrega no controllerchange. Forçar skipWaiting aqui pularia o waiting e
        // o needRefresh nunca dispararia (a página não recarregaria).
        runtimeCaching: [
          {
            // A API pode responder com dados de qualquer conta autenticada. Cache
            // compartilhado do service worker é indexado por URL, não por usuário,
            // portanto nunca deve guardar /api (nem como fallback offline).
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
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
    // (5.5) Analisador de bundle: gera dist/stats.html (treemap com gzip/brotli)
    // só quando ANALYZE=true (`npm run analyze`). Não roda no build normal.
    ...(process.env.ANALYZE
      ? [visualizer({
          filename: 'dist/stats.html',
          gzipSize: true,
          brotliSize: true,
          template: 'treemap',
        }) as any]
      : []),
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
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json', 'lcov'],
      // Arquivos com lógica de negócio que devem ser monitorados
      include: [
        'src/utils/**/*.ts',
        'src/hooks/**/*.ts',
        'src/services/**/*.ts',
        'src/contexts/**/*.tsx',
        'src/pages/**/*.tsx',
      ],
      exclude: [
        'src/**/*.test.*',
        'src/**/*.spec.*',
        'src/test/**',
        'src/main.tsx',
        'src/prerender.tsx',
      ],
      // Piso inicial baseado na linha de base de 12/07/2026. O objetivo é
      // impedir regressão enquanto a cobertura de páginas e contexts avança.
      thresholds: {
        lines: 20,
        statements: 20,
        functions: 40,
        branches: 70,
      },
    },
  }
});
