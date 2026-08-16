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
    // `on-first-retry` nunca gravava nada local (retries=0 fora do CI): quando um
    // teste falhava uma única vez, não sobrava trace para investigar. Guardar em
    // toda falha custa disco só quando algo quebra e mantém o flake diagnosticável.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Sobe o app automaticamente antes dos testes e derruba ao final.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // NUNCA reusar: com `reuseExistingServer`, qualquer `vite preview` esquecido na
    // 4173 faz o Playwright PULAR o `npm run build` e rodar a suíte contra o `dist/`
    // antigo. O sintoma é um teste isolado falhando de forma "intermitente" (o
    // bundle velho ainda tem o bug que o teste cobre) e voltando ao verde no run
    // seguinte, quando o servidor órfão já morreu. Com `false` + `--strictPort`, a
    // porta ocupada vira erro alto e claro em vez de um bundle silenciosamente velho.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
