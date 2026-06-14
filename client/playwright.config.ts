import { defineConfig, devices } from '@playwright/test';

/**
 * 2.6 — Testes de integração ponta-a-ponta (Playwright).
 *
 * O robô abre o site REAL (build do Vite) e clica como um usuário:
 * login → carteira → adicionar ativo. O backend é interceptado no nível do
 * browser (page.route), então o teste roda 100% offline, sem MongoDB nem
 * server Express — ideal para CI (o workflow já roda em ubuntu sem banco).
 *
 * Servidor sob teste: `vite preview` do build de produção (porta 4173). Usar o
 * preview (e não `vite dev`) garante que validamos o mesmo bundle que vai pro ar.
 */
export default defineConfig({
  testDir: './e2e',
  // Falha o CI se alguém esquecer um test.only commitado.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // E2E driblando rede externa: serial é suficiente e mais estável.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Sobe o app automaticamente antes dos testes e derruba ao final.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
