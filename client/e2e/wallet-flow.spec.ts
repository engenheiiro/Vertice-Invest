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
    sharpeRatio: null, // sem histórico de snapshots não há risco medível
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
async function mockBackend(page: Page, wallet: unknown = EMPTY_WALLET) {
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
  await page.route('**/api/wallet', (route) => json(route, wallet));
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

  // A casa do app autenticado é a CARTEIRA (config/homeRoute.ts). O tour só
  // desvia para /dashboard quando hasSeenTutorial === false, e o TEST_USER já viu.
  await page.waitForURL('**/wallet', { timeout: 10_000 });

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

/**
 * Carteira com movimento, para o detalhamento do dia ter o que explicar.
 *
 * As contribuições por ativo SOMAM o `dayVariation` dos KPIs (214,80 + 18,90
 * − 96,70 = 137,00). É a propriedade que o painel promete ao usuário, e é a
 * primeira que quebraria se alguém passasse a recalcular a variação na tela.
 */
const WALLET_WITH_MOVEMENT = {
  ...EMPTY_WALLET,
  assets: [
    {
      id: 'a1', ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', quantity: 100,
      averagePrice: 30, currentPrice: 32.15, totalValue: 3215, totalCost: 3000,
      profit: 215, profitPercent: 7.17, currency: 'BRL', sector: 'Petróleo',
      dayChangeValue: 214.8, dayChangePct: 1.62, dayChangeReason: 'ANCHOR_CLOSE',
    },
    {
      id: 'a2', ticker: 'VALE3', name: 'Vale', type: 'STOCK', quantity: 80,
      averagePrice: 60, currentPrice: 58.4, totalValue: 4672, totalCost: 4800,
      profit: -128, profitPercent: -2.67, currency: 'BRL', sector: 'Mineração',
      dayChangeValue: -96.7, dayChangePct: -1.18, dayChangeReason: 'ANCHOR_CLOSE',
    },
    {
      id: 'a3', ticker: 'RECR11', name: 'REC Recebíveis', type: 'FII', quantity: 50,
      averagePrice: 90, currentPrice: 91, totalValue: 4550, totalCost: 4500,
      profit: 50, profitPercent: 1.11, currency: 'BRL', sector: 'Papel',
      dayChangeValue: 0, dayChangePct: 0, dayChangeReason: 'STALE_QUOTE',
    },
  ],
  kpis: {
    ...EMPTY_WALLET.kpis,
    totalEquity: 12437, totalInvested: 12300, totalResult: 137,
    dayVariation: 137, dayVariationPercent: 1.11,
    dayAnchorDate: '2026-08-31', dayDividends: 0,
  },
};

// O spec navega duas vezes (/login → /wallet) e, a partir da segunda, o service
// worker do vite-plugin-pwa assume as chamadas /api — page.route deixa de
// interceptar e a carteira chega vazia. O teste acima não notava porque o mock
// dele já era uma carteira vazia; este, que depende do conteúdo, notaria em
// silêncio (tela zerada parecendo bug de aplicação).
test.describe(() => {
  test.use({ serviceWorkers: 'block' });

  test('usuário abre o detalhamento do dia pelo card de Variação Hoje', async ({ page }) => {
  await mockBackend(page, WALLET_WITH_MOVEMENT);

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(TEST_USER.email);
  await page.getByLabel('Senha', { exact: true }).fill('SenhaSegura123!');
  await page.getByRole('button', { name: /Entrar/i }).click();
  await page.waitForURL('**/wallet', { timeout: 10_000 });

  await page.goto('/wallet');

  // O card mostra o total do dia; o botão promete explicá-lo.
  const verODia = page.getByRole('button', { name: /Ver o dia/i }).first();
  await expect(verODia).toBeVisible();
  await verODia.click();

  const dialog = page.getByRole('dialog', { name: /O dia da sua carteira/i });
  // O total do modal é o MESMO do card — o painel explica, não recalcula.
  await expect(dialog.getByText('+R$ 137,00')).toBeVisible();
  await expect(dialog.getByText(/desde o fechamento de segunda-feira, 31\/08/)).toBeVisible();

  // Maior alta primeiro, maior queda por último.
  await expect(dialog.getByText('PETR4')).toBeVisible();
  // A linha marca a direção com seta (não com sinal); só o total do topo leva '+'.
  await expect(dialog.getByText('R$ 214,80')).toBeVisible();
  await expect(dialog.getByText('-R$ 96,70')).toBeVisible();

  // A posição sem negócio hoje continua LISTADA, com o motivo — o zero é nosso,
  // não do mercado, e escondê-lo seria esconder o limite do dado.
  await expect(dialog.getByText('sem negócio hoje')).toBeVisible();
  });
});
