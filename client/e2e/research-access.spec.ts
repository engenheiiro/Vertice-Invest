import { expect, test } from '@playwright/test';

test('assinante Pro acessa Research e consulta o ranking de ações brasileiras', async ({ page }) => {
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
  const report = {
    _id: 'analysis-1',
    assetClass: 'STOCK',
    strategy: 'BUY_HOLD',
    content: { morningCall: '', ranking: [] },
  };

  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/api/research/latest?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) })
  );
  await page.route('**/api/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user, accessToken: 'research-access-token' }),
    })
  );

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill('SenhaSegura123!');
  await page.getByRole('button', { name: /Entrar/i }).click();
  await page.waitForURL('**/dashboard');

  await page.goto('/research');
  await expect(page.getByRole('heading', { name: 'RESEARCH CENTER' })).toBeVisible();
  await expect(page.getByText('Plano Ativo: PRO')).toBeVisible();

  const request = page.waitForRequest((candidate) =>
    candidate.url().includes('/api/research/latest?assetClass=STOCK&strategy=BUY_HOLD')
  );
  await page.getByRole('button', { name: 'Ações BR' }).click();
  await request;
});
