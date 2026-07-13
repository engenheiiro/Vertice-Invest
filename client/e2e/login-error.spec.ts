import { expect, test } from '@playwright/test';

test('credenciais inválidas mantêm o usuário no login e exibem o erro do servidor', async ({ page }) => {
  // Evita qualquer dependência do backend real; o contrato de erro é o mesmo da API.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/api/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Credenciais inválidas.' }),
    })
  );

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('investidor@vertice.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-incorreta');
  await page.getByRole('button', { name: /Entrar/i }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Credenciais inválidas.')).toBeVisible();
});
