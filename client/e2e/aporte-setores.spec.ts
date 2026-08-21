import { expect, test } from '@playwright/test';

/**
 * Aporte Inteligente (aba FIIs) — leitura setorial ponta-a-ponta.
 *
 * Cobre o que o teste de unidade não alcança: o modal recebe o ranking publicado
 * da Research E as posições da carteira do usuário (dois contextos diferentes),
 * e é do cruzamento dos dois que sai a projeção "como fica minha carteira".
 */
// O service worker do PWA responde antes do page.route e engole os mocks.
test.use({ serviceWorkers: 'block' });

const user = {
  id: 'research-user',
  name: 'Investidor Pro',
  email: 'pro@vertice.test',
  plan: 'PRO',
  subscriptionStatus: 'ACTIVE',
  role: 'USER',
  hasSeenTutorial: true,
  mfaEnabled: false,
};

const fii = (ticker: string, sector: string, currentPrice: number, score: number) => ({
  position: 1,
  ticker,
  name: ticker,
  sector,
  type: 'FII',
  action: 'BUY',
  currentPrice,
  targetPrice: currentPrice * 1.1,
  score,
  probability: 0.8,
  riskProfile: 'DEFENSIVE',
  thesis: 'Tese',
  reason: 'Motivo',
  auditLog: [],
  metrics: { dy: 10, pvp: 0.95, marketCap: 2e9, structural: { quality: 70, valuation: 70, risk: 70 } },
});

const report = {
  _id: 'analysis-fii',
  date: new Date().toISOString(),
  assetClass: 'FII',
  strategy: 'BUY_HOLD',
  isRankingPublished: true,
  isMorningCallPublished: true,
  content: {
    morningCall: '',
    ranking: [
      fii('KNCR11', 'Títulos e Val. Mob.', 106, 99),
      fii('KNSC11', 'Papel', 8.96, 96),
      fii('TRXF11', 'Renda Urbana', 74, 94),
      fii('GGRC11', 'Logística', 9.07, 92),
      fii('BTLG11', 'Logística', 97.4, 92),
      fii('HGRU11', 'Renda Urbana', 113.09, 87),
      fii('VISC11', 'Shoppings', 102.5, 85),
    ],
  },
};

const holding = (ticker: string, sector: string, totalValue: number) => ({
  id: ticker,
  ticker,
  type: 'FII',
  quantity: 10,
  averagePrice: totalValue / 10,
  currentPrice: totalValue / 10,
  totalValue,
  totalCost: totalValue,
  profit: 0,
  profitPercent: 0,
  currency: 'BRL',
  sector,
});

test('Aporte Inteligente (FIIs) mostra setor por linha e as duas pizzas', async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/api/refresh', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'tok' }) })
  );
  await page.route((u) => u.pathname === '/api/wallets', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ activeWalletId: 'w1', wallets: [{ id: 'w1', name: 'Principal', isDefault: true }] }),
    })
  );
  await page.route((u) => u.pathname === '/api/wallet', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        assets: [
          holding('VISC11', 'Shoppings', 12000),
          holding('HGLG11', 'Logística', 6000),
          holding('MXRF11', 'Papel', 2000),
        ],
      }),
    })
  );
  await page.route((u) => u.pathname === '/api/research/latest', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) })
  );
  await page.route('**/api/login', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user, accessToken: 'tok' }) })
  );

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill('SenhaSegura123!');
  await page.getByRole('button', { name: /Entrar/i }).click();
  await page.waitForURL('**/dashboard');

  await page.goto('/research');
  await page.getByRole('button', { name: 'FIIs' }).click();
  await page.getByRole('button', { name: /Aporte/ }).click();

  await page.getByRole('button', { name: 'Entendi' }).click();

  // O nó role=dialog é só o wrapper (filhos fixed, altura 0): o alvo visível é o painel.
  const panel = page.locator('div[role="dialog"][aria-modal="true"] .max-w-lg');
  await expect(panel.getByRole('heading', { name: 'Aporte Inteligente' })).toBeVisible();
  await panel.getByPlaceholder('0,00').fill('478.03');

  await expect(panel.getByText('Alocação setorial')).toBeVisible();
  await expect(panel.getByText('Do aporte', { exact: true })).toBeVisible();
  await expect(panel.getByText('Sua carteira depois')).toBeVisible();
  await expect(panel.getByText('Papel (CRI)').first()).toBeVisible();

  // A projeção cruza carteira (Shoppings 12k / Logística 6k / Papel 2k) com as compras:
  // shopping não é comprado e se dilui, o papel comprado ganha peso.
  await expect(panel.getByText('antes 60.0% (−1.4 pp)')).toBeVisible();
  await expect(panel.getByText('antes 10.0% (+0.6 pp)')).toBeVisible();
});
