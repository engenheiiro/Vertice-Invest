import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * 2.6 — E2E ponta-a-ponta: login → carteira → adicionar ativo.
 *
 * O robô dirige o frontend REAL como um usuário de verdade. O backend é
 * interceptado no browser (page.route), então não há dependência de MongoDB
 * nem do server Express — roda offline e determinístico (bom para CI).
 *
 * A jornada validada é a do plano: entrar com e-mail/senha, cair no app
 * autenticado, abrir a carteira e registrar uma compra de PETR4 — conferindo
 * que o payload enviado ao backend (POST /api/wallet/add) está correto.
 */

const TEST_USER = {
  id: 'e2e-user-1',
  name: 'Investidor Teste',
  email: 'investidor@vertice.test',
  plan: 'PRO',
  subscriptionStatus: 'ACTIVE',
  role: 'USER',
  // hasSeenTutorial=true é CRÍTICO: evita que o DemoContext entre em modo demo
  // (que injeta ativos fake e bloqueia addAsset com `if (isDemoMode) return`).
  hasSeenTutorial: true,
  mfaEnabled: false,
};

const EMPTY_WALLET = {
  assets: [],
  kpis: {
    totalEquity: 0,
    totalInvested: 0,
    totalResult: 0,
    totalResultPercent: 0,
    dayVariation: 0,
    dayVariationPercent: 0,
    totalDividends: 0,
    projectedDividends: 0,
    weightedRentability: 0,
    dataQuality: 'AUDITED',
    sharpeRatio: 0,
    beta: 1,
  },
  meta: { usdRate: 5.75 },
  targetAllocation: { STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10 },
  targetReserve: 10000,
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Instala todos os mocks de API. Retorna um objeto cujo `.body` é preenchido
 * com o payload do POST /api/wallet/add quando o robô confirma a compra.
 *
 * Ordem importa: o Playwright executa a rota registrada por ÚLTIMO primeiro,
 * então o catch-all é registrado ANTES das rotas específicas.
 */
async function mockBackend(page: Page) {
  const captured: { addBody: any } = { addBody: null };

  // Catch-all benigno: qualquer /api/** não tratada responde algo inócuo,
  // impedindo que o app quebre por uma rota esquecida (dashboard, search, etc.).
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    // Endpoints conhecidos por retornarem objeto; o resto cai em [].
    if (/\/api\/(research|market|subscription)/.test(url)) return json(route, {});
    return json(route, []);
  });

  // --- Autenticação ---
  await page.route('**/api/login', (route) =>
    json(route, { user: TEST_USER, accessToken: 'e2e-access-token' })
  );
  await page.route('**/api/refresh', (route) => json(route, { accessToken: 'e2e-access-token' }));
  await page.route('**/api/logout', (route) => json(route, { ok: true }));
  await page.route('**/api/subscription/status', (route) =>
    json(route, { current: { plan: 'PRO', subscriptionStatus: 'ACTIVE', role: 'USER' } })
  );

  // --- Carteira ---
  await page.route('**/api/wallet', (route) => json(route, EMPTY_WALLET));
  await page.route('**/api/wallet/history', (route) => json(route, []));

  // O alvo do teste: captura o corpo e devolve sucesso.
  await page.route('**/api/wallet/add', (route) => {
    captured.addBody = route.request().postDataJSON();
    return json(route, { message: 'Ativo adicionado com sucesso.', asset: { ticker: 'PETR4' } });
  });

  return captured;
}

test('usuário loga, abre a carteira e registra uma compra de PETR4', async ({ page }) => {
  const captured = await mockBackend(page);

  // 1) LOGIN ─────────────────────────────────────────────────────────────────
  await page.goto('/login');
  // exact: true evita colidir com o botão "Mostrar senha" (aria-label).
  await page.getByLabel('Email', { exact: true }).fill(TEST_USER.email);
  await page.getByLabel('Senha', { exact: true }).fill('SenhaSegura123!');
  await page.getByRole('button', { name: /Entrar/i }).click();

  // O app navega para /dashboard ~600ms após o login bem-sucedido.
  await page.waitForURL('**/dashboard', { timeout: 10_000 });

  // 2) CARTEIRA ────────────────────────────────────────────────────────────────
  await page.goto('/wallet');
  const novaTransacao = page.getByRole('button', { name: /Nova Transação/i }).first();
  await expect(novaTransacao).toBeVisible();
  await novaTransacao.click();

  // 3) MODAL "ADICIONAR ATIVO" ─────────────────────────────────────────────────
  // Nome acessível "Nova Transação" desambigua do dialog do aviso de cookies.
  // (Não checamos visibilidade do wrapper: ele tem filhos `fixed` e colapsa a
  // 0x0 — o Playwright o veria como hidden. Validamos os campos internos.)
  const dialog = page.getByRole('dialog', { name: /Nova Transação/i });
  const tickerInput = dialog.getByLabel(/Código \/ Ticker/i);
  await expect(tickerInput).toBeVisible();

  // Preenche os três campos obrigatórios da compra (BUY é o modo inicial).
  await tickerInput.fill('PETR4');
  await dialog.getByLabel(/Quantidade/i).fill('100');
  // CurrencyInput: "3500" (centavos) → exibe "35,00" → parseCurrencyToFloat → 35.
  await dialog.getByLabel(/Preço Unitário/i).fill('3500');

  const confirmar = dialog.getByRole('button', { name: /Confirmar/i });
  await expect(confirmar).toBeEnabled();
  await confirmar.click();

  // 4) ASSERÇÕES ───────────────────────────────────────────────────────────────
  // O payload enviado ao backend deve refletir a compra exatamente.
  await expect.poll(() => captured.addBody, { timeout: 7_000 }).not.toBeNull();
  expect(captured.addBody).toMatchObject({
    ticker: 'PETR4',
    type: 'STOCK',
    quantity: 100,
    price: 35,
    currency: 'BRL',
  });

  // E o usuário recebe o feedback de sucesso.
  await expect(page.getByText(/sucesso/i)).toBeVisible();
});
