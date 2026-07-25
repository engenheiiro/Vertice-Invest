import { expect, test } from '@playwright/test';

/**
 * Regressão de 25/07/2026 — "Publicar Tudo Pendente" dizia que publicou sem ter
 * publicado. `researchService.publish()` não checava `response.ok`, então um 429
 * do `adminLimiter` resolvia como sucesso e o painel pintava o banner verde.
 *
 * Este é o teste no nível em que o bug foi percebido: o admin clica no botão, o
 * servidor devolve 429, e a tela TEM de mostrar erro — nunca "publicadas com
 * sucesso". O backend é interceptado no browser (page.route), sem Mongo.
 */

/**
 * O app registra um service worker (vite-plugin-pwa). Depois da segunda
 * navegação completa ele passa a controlar a página, e aí as chamadas de API
 * saem pelo SW — fora do alcance do `page.route`, que só intercepta requisições
 * da própria página. Sem bloquear o SW, os mocks abaixo seriam ignorados na
 * navegação para /admin e a tela receberia 404 de verdade.
 */
test.use({ serviceWorkers: 'block' });

const ADMIN = {
  id: 'admin-user',
  name: 'Admin Teste',
  email: 'admin@vertice.test',
  plan: 'BLACK',
  subscriptionStatus: 'ACTIVE',
  role: 'ADMIN',
  hasSeenTutorial: true,
  mfaEnabled: false,
};

const RATE_LIMIT_MESSAGE = 'Muitas operações de administração. Aguarde alguns minutos.';

// Duas classes com draft pronto — o botão só habilita com readyToPublish.
const PENDING_STATUS = [
  {
    assetClass: 'STOCK',
    lastSyncAt: new Date().toISOString(),
    lastPublishedAt: null,
    isRankingPublished: false,
    isReportPublished: false,
    isExplainableAIPublished: false,
    hasComparisonReport: true,
    hasExplainableAIPrompt: true,
    hasGeneratedExplainableAI: true,
    latestId: '6a63ffe87af159559d35bf06',
    readyToPublish: true,
  },
  {
    assetClass: 'FII',
    lastSyncAt: new Date().toISOString(),
    lastPublishedAt: null,
    isRankingPublished: false,
    isReportPublished: false,
    isExplainableAIPublished: false,
    hasComparisonReport: true,
    hasExplainableAIPrompt: true,
    hasGeneratedExplainableAI: true,
    latestId: '6a63ffe87af159559d35bf07',
    readyToPublish: true,
  },
];

const loginAsAdmin = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/api/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'admin-refreshed-access-token' }),
    })
  );
  await page.route('**/api/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: ADMIN, accessToken: 'admin-access-token' }),
    })
  );
  // Listas que o painel carrega ao montar — array vazio evita ruído de render.
  for (const path of ['history', 'discard-logs', 'accuracy**']) {
    await page.route(`**/api/research/${path}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
  }
  await page.route('**/api/research/publish-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PENDING_STATUS) })
  );

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(ADMIN.email);
  await page.getByLabel('Senha', { exact: true }).fill('SenhaSegura123!');
  await page.getByRole('button', { name: /Entrar/i }).click();
  await page.waitForURL('**/dashboard');
};

test('publicar tudo pendente com 429 mostra erro, não sucesso', async ({ page }) => {
  await loginAsAdmin(page);

  let publishCalls = 0;
  await page.route('**/api/research/publish', (route) => {
    publishCalls++;
    return route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ message: RATE_LIMIT_MESSAGE }),
    });
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Operações' }).click();
  await page.getByRole('button', { name: /Publicar Tudo Pendente/i }).click();

  // O banner tem de acusar a falha e repetir a razão vinda do servidor.
  await expect(page.getByText(/0\/2 publicadas/i)).toBeVisible();
  await expect(page.getByText(new RegExp(RATE_LIMIT_MESSAGE.slice(0, 30), 'i'))).toBeVisible();
  // E jamais o texto de sucesso.
  await expect(page.getByText(/publicadas com sucesso/i)).toHaveCount(0);
  // Uma falha no meio não pode abortar o restante da fila.
  expect(publishCalls).toBe(2);
});

test('publicar tudo pendente com sucesso mostra confirmação', async ({ page }) => {
  await loginAsAdmin(page);

  await page.route('**/api/research/publish', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Publicado.',
        activated: ['RANKING', 'MORNING_CALL', 'REPORT', 'EXPLAINABLE_AI'],
        skipped: [],
      }),
    })
  );

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Operações' }).click();
  await page.getByRole('button', { name: /Publicar Tudo Pendente/i }).click();

  await expect(page.getByText(/2 classe\(s\) publicadas com sucesso/i)).toBeVisible();
});

/**
 * O caso real de jul/2026: ranking e relatório prontos, Morning Call e
 * Explainable IA ainda não gerados. Antes da publicação parcial isso derrubava a
 * classe inteira com 409; agora o que está pronto vai ao ar e o admin é avisado
 * do que ficou de fora.
 */
test('publicação parcial informa as seções que ficaram de fora', async ({ page }) => {
  await loginAsAdmin(page);

  const bodies: unknown[] = [];
  await page.route('**/api/research/publish', async (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Publicado.',
        activated: ['RANKING', 'REPORT'],
        skipped: ['MORNING_CALL', 'EXPLAINABLE_AI'],
      }),
    });
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Operações' }).click();
  await page.getByRole('button', { name: /Publicar Tudo Pendente/i }).click();

  await expect(page.getByText(/2 classe\(s\) publicadas com sucesso/i)).toBeVisible();
  await expect(page.getByText(/Morning Call, Explainable IA/i)).toBeVisible();
  // O botão em massa é o único que pede modo parcial.
  expect(bodies).toEqual([
    { analysisId: '6a63ffe87af159559d35bf06', type: 'ALL', partial: true },
    { analysisId: '6a63ffe87af159559d35bf07', type: 'ALL', partial: true },
  ]);
});
