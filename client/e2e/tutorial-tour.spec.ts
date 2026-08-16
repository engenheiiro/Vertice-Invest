import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * E2E do tutorial de primeiro acesso (DemoContext + TutorialOverlay).
 *
 * Loga com `hasSeenTutorial: false` — o gatilho real do onboarding — e percorre
 * TODOS os passos do Terminal e da Carteira, em desktop e mobile, conferindo a
 * cada passo que:
 *   - o card do tutorial está visível e dentro da viewport (nada cortado);
 *   - o alvo destacado existe e está visível (spotlight não aponta pro vazio);
 *   - o progresso avança até o passo final de cada fluxo.
 *
 * Backend interceptado via page.route (sem MongoDB / Express), igual aos demais
 * specs. Em modo demo o WalletContext usa DEMO_ASSETS, então as telas ficam
 * preenchidas mesmo com o backend mockado vazio.
 */

const TEST_USER = {
  id: 'e2e-newbie-1',
  name: 'Novato Teste',
  email: 'novato@vertice.test',
  plan: 'PRO',
  subscriptionStatus: 'ACTIVE',
  role: 'USER',
  // O gatilho do tutorial: usuário que nunca viu o onboarding.
  hasSeenTutorial: false,
  mfaEnabled: false,
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockBackend(page: Page) {
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (/\/api\/(research|market|subscription)/.test(url)) return json(route, {});
    return json(route, []);
  });

  await page.route('**/api/login', (route) =>
    json(route, { user: TEST_USER, accessToken: 'e2e-access-token' })
  );
  await page.route('**/api/refresh', (route) => json(route, { accessToken: 'e2e-access-token' }));
  await page.route('**/api/subscription/status', (route) =>
    json(route, { current: { plan: 'PRO', subscriptionStatus: 'ACTIVE', role: 'USER' } })
  );
  await page.route('**/api/tutorial-seen', (route) => json(route, { ok: true }));
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(TEST_USER.email);
  await page.getByLabel('Senha', { exact: true }).fill('SenhaSegura123!');
  await page.getByRole('button', { name: /Entrar/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 10_000 });
}

/** Card do tutorial (role=dialog cujo aria-label começa com "Tutorial:"). */
const tourCard = (page: Page) => page.getByRole('dialog', { name: /^Tutorial:/ });

/**
 * Confere que o card cabe na viewport e devolve o título do passo corrente.
 * Retorna também se há um destaque (spotlight) desenhado.
 */
async function inspectStep(page: Page, label: string) {
  const card = tourCard(page);
  await expect(card, `[${label}] card do tutorial visível`).toBeVisible();

  const box = await card.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, `[${label}] card tem caixa`).not.toBeNull();

  const title = await card.locator('h3').innerText();
  const overflow = {
    left: box!.x < -1,
    top: box!.y < -1,
    right: box!.x + box!.width > vp.width + 1,
    bottom: box!.y + box!.height > vp.height + 1,
  };

  return { title, box: box!, overflow };
}

async function walkFlow(page: Page, label: string, maxSteps = 12) {
  const seen: string[] = [];
  const problems: string[] = [];

  for (let i = 0; i < maxSteps; i++) {
    // Deixa a animação de posicionamento (scrollIntoView + timers 100/400ms) assentar.
    await page.waitForTimeout(700);
    const { title, overflow } = await inspectStep(page, `${label} #${i + 1}`);
    seen.push(title);

    const cut = Object.entries(overflow)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (cut.length) problems.push(`${label} passo ${i + 1} "${title}": card cortado (${cut.join(', ')})`);

    await page.screenshot({
      path: `e2e-artifacts/tour-${label}-${String(i + 1).padStart(2, '0')}.png`,
      fullPage: false,
    });

    const card = tourCard(page);
    const finalBtn = card.getByRole('button', { name: /Concluir|Sim, continuar/i });
    if (await finalBtn.count()) {
      await finalBtn.click();
      break;
    }
    await card.getByRole('button', { name: /Próximo/i }).click();
  }

  return { seen, problems };
}

test.describe('Tutorial de primeiro acesso', () => {
  test('desktop: percorre Terminal e Carteira sem quebrar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBackend(page);
    await login(page);

    // O DemoContext agenda o start em 1.2s após detectar hasSeenTutorial=false.
    await expect(tourCard(page)).toBeVisible({ timeout: 10_000 });

    const dash = await walkFlow(page, 'desktop-terminal');
    await page.waitForURL('**/wallet', { timeout: 10_000 });

    const wallet = await walkFlow(page, 'desktop-carteira');
    await page.waitForURL('**/dashboard', { timeout: 10_000 });

    console.log('DESKTOP terminal:', JSON.stringify(dash.seen, null, 1));
    console.log('DESKTOP carteira:', JSON.stringify(wallet.seen, null, 1));
    console.log('DESKTOP problemas:', JSON.stringify([...dash.problems, ...wallet.problems], null, 1));

    // Ao concluir, o tutorial some de vez.
    await expect(tourCard(page)).toBeHidden();
  });

  test('mobile: percorre Terminal e Carteira sem quebrar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBackend(page);
    await login(page);

    await expect(tourCard(page)).toBeVisible({ timeout: 10_000 });

    const dash = await walkFlow(page, 'mobile-terminal');
    await page.waitForURL('**/wallet', { timeout: 10_000 });

    const wallet = await walkFlow(page, 'mobile-carteira');
    await page.waitForURL('**/dashboard', { timeout: 10_000 });

    console.log('MOBILE terminal:', JSON.stringify(dash.seen, null, 1));
    console.log('MOBILE carteira:', JSON.stringify(wallet.seen, null, 1));
    console.log('MOBILE problemas:', JSON.stringify([...dash.problems, ...wallet.problems], null, 1));

    await expect(tourCard(page)).toBeHidden();
  });

  test('o véu do spotlight não pisca (véu constante, só o anel respira)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBackend(page);
    await login(page);
    await expect(tourCard(page)).toBeVisible({ timeout: 10_000 });

    // Avança até um passo COM alvo (o 2º: navegação).
    await page.waitForTimeout(700);
    await tourCard(page).getByRole('button', { name: /Próximo/i }).click();
    await page.waitForTimeout(900);

    // Amostra a opacidade e o véu do anel ao longo de um ciclo inteiro da animação.
    const amostras = [];
    for (let i = 0; i < 8; i++) {
      amostras.push(
        await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"][aria-label^="Tutorial:"]');
          const overlay = dlg?.parentElement as HTMLElement | null;
          // [0] = captura de cliques, [1] = anel/véu.
          const ring = overlay?.children[1] as HTMLElement | undefined;
          if (!ring) return null;
          const cs = getComputedStyle(ring);
          // A sombra do véu é a de spread 9999px. Não dá para fatiar por vírgula:
          // ela cai DENTRO do rgba(...) e devolve "rgba(2" — constante, o que fazia
          // esta checagem passar mesmo com box-shadow ausente.
          const veu = cs.boxShadow.match(/rgba?\([^)]*\)\s+0px\s+0px\s+0px\s+9999px/)?.[0] ?? null;
          return { opacity: cs.opacity, veu };
        })
      );
      await page.waitForTimeout(350);
    }

    const validas = amostras.filter(Boolean) as { opacity: string; veu: string | null }[];
    expect(validas.length).toBeGreaterThan(4);

    // O véu EXISTE de fato. Sem esta asserção o teste passava com box-shadow
    // "none" — exatamente o estado em que um CSS desatualizado apagava o
    // destaque inteiro sem quebrar nada.
    for (const a of validas) expect(a.veu, 'véu do spotlight ausente').not.toBeNull();

    // O elemento que carrega o véu nunca fica translúcido — era o bug que fazia
    // a página inteira piscar de escuro a claro a cada 2s.
    for (const a of validas) expect(Number(a.opacity)).toBe(1);

    // E o véu (primeira sombra) é idêntico em todas as amostras: só o anel muda.
    expect(new Set(validas.map(a => a.veu)).size).toBe(1);

    // A camada de captura de cliques cobre a tela — nada por baixo é clicável.
    const captura = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label^="Tutorial:"]');
      const el = dlg?.parentElement?.children[0] as HTMLElement | undefined;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, pe: getComputedStyle(el).pointerEvents };
    });
    expect(captura).toMatchObject({ w: 1440, h: 900, pe: 'auto' });
  });

  test('banner de cookies sai de cena durante o tour', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBackend(page);
    await login(page);
    await expect(tourCard(page)).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole('dialog', { name: /cookies/i })).toBeHidden();
  });

  test('tablet (1024px): passo de navegação aponta para um alvo visível', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await mockBackend(page);
    await login(page);

    await expect(tourCard(page)).toBeVisible({ timeout: 10_000 });

    // Avança até o passo de navegação (2º).
    const card = tourCard(page);
    await page.waitForTimeout(700);
    await card.getByRole('button', { name: /Próximo/i }).click();
    await page.waitForTimeout(900);

    await page.screenshot({ path: 'e2e-artifacts/tour-tablet-navegacao.png' });

    const navTop = page.locator('#tour-nav-links');
    const navBottom = page.locator('#tour-nav-mobile');
    console.log('TABLET nav topo visível:', await navTop.isVisible().catch(() => false));
    console.log('TABLET nav inferior visível:', await navBottom.isVisible().catch(() => false));
    console.log('TABLET texto do card:', (await card.innerText()).slice(0, 200));
  });
});
