import { expect, test } from '@playwright/test';

test('retorno de pagamento rejeitado informa o usuário e oferece nova tentativa', async ({ page }) => {
  const user = {
    id: 'checkout-user',
    name: 'Investidor Teste',
    email: 'investidor@vertice.test',
    plan: 'PRO',
    subscriptionStatus: 'ACTIVE',
    role: 'USER',
    hasSeenTutorial: true,
    mfaEnabled: false,
  };
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/api/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user, accessToken: 'checkout-access-token' }),
    })
  );

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill('SenhaSegura123!');
  await page.getByRole('button', { name: /Entrar/i }).click();
  await page.waitForURL('**/dashboard');

  await page.goto('/checkout/success?plan=PRO&status=rejected');

  await expect(page.getByRole('heading', { name: 'Pagamento não aprovado' })).toBeVisible();
  await expect(page.getByText(/não foi aprovado/i)).toBeVisible();

  await page.getByRole('button', { name: /tentar novamente/i }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});
