import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Segredos de brinquedo: o app valida a presença deles no import. Nenhum token é
// emitido aqui — o teste só olha headers e status do shell.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-para-contrato-do-shell';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-para-contrato';
// O SDK do Gemini exige chave já na construção (import de aiEnhancementService).
process.env.API_KEY = process.env.API_KEY || 'test-gemini-key';

// O app puro não inicia o scheduler; o mock mantém os controllers que importam
// funções de snapshot isolados de qualquer rotina real.
vi.mock('../services/schedulerService.js', () => ({
    initScheduler: () => {},
    runDailySnapshot: async () => ({ status: 'SKIPPED' }),
    backfillMissedSnapshots: async () => ({ status: 'SKIPPED' }),
}));

// Feriados vêm da BrasilAPI por HTTP. Um teste de contrato do shell não pode
// depender de rede externa: sem o mock ele fica lento e falha de forma
// intermitente quando a suíte roda em paralelo (visto na prática).
vi.mock('../services/holidayService.js', () => ({
    holidayService: {
        sync: async () => {},
        isHoliday: () => false,
        getHolidays: () => [],
    },
}));

let server;
let base;

// Importar o app puxa rotas, controllers e models — é pesado, e o default de 5s
// do vitest estoura quando a suíte inteira roda junto.
beforeAll(async () => {
    const { default: app } = await import('../app.js');
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
});

describe('CSP do shell', () => {
    it('autoriza os scripts inline do próprio app por hash', async () => {
        const res = await fetch(`${base}/login`);
        const csp = res.headers.get('content-security-policy') || '';
        const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src ')) || '';

        // Anti-FOUC de tema e auto-recuperação: 2 inline no shell buildado.
        //
        // Eram 3 até o GA4 sair do index.html (30/08/2026): a tag passou a ser
        // injetada por código, só depois do consentimento, e script com `src` é
        // autorizado pela ORIGEM — por isso o teste seguinte cobra
        // googletagmanager.com na política, e este não cobra mais um hash.
        // O número velho sobreviveu ao commit porque a CSP é derivada de
        // client/dist, e um dist antigo na máquina ainda continha o bloco.
        const hashes = scriptSrc.match(/'sha256-[^']+'/g) || [];
        expect(hashes.length).toBeGreaterThanOrEqual(2);
    });

    it('libera o gtag.js — sem isso o GA4 nunca mede nada', async () => {
        const res = await fetch(`${base}/login`);
        const csp = res.headers.get('content-security-policy') || '';
        expect(csp).toContain('https://www.googletagmanager.com');
        expect(csp).toContain('google-analytics.com');
    });

    it('não afrouxa para unsafe-inline (o hash existe justamente para evitar isso)', async () => {
        const res = await fetch(`${base}/login`);
        const csp = res.headers.get('content-security-policy') || '';
        const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src ')) || '';
        expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it('libera blob: em img-src — sem isso o anexo de ticket não entra NEM sai', async () => {
        // Este teste nasceu de um defeito real (VT-0001) e cobre os dois lados
        // do mesmo object URL:
        //   enviar  → a imagem escolhida é decodificada num <img> antes de comprimir;
        //   exibir  → o anexo vem por fetch autenticado e vira object URL.
        // Bloqueado, o navegador dispara `onerror` e a tela acusa "Arquivo de
        // imagem inválido" — culpando o arquivo do usuário, não a política.
        //
        // Nenhum teste de componente pega isso: jsdom não aplica CSP, e o Vite
        // de desenvolvimento não manda esse header. Só o app de verdade manda.
        const res = await fetch(`${base}/login`);
        const csp = res.headers.get('content-security-policy') || '';
        const imgSrc = csp.split(';').find((d) => d.trim().startsWith('img-src ')) || '';

        expect(imgSrc).toContain('blob:');
        // `data:` continua necessário: é o formato em que o anexo comprimido
        // viaja no corpo da requisição e aparece na pré-visualização.
        expect(imgSrc).toContain('data:');
    });
});

describe('fallback da SPA', () => {
    it('asset inexistente é 404 — nunca index.html com 200 (era isso que travava o app inteiro)', async () => {
        const res = await fetch(`${base}/assets/index-BF-eqTWs.js`);
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type') || '').not.toContain('text/html');
    });

    it('rota da SPA continua devolvendo o shell', async () => {
        const res = await fetch(`${base}/login`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type') || '').toContain('text/html');
        expect(res.headers.get('cache-control')).toBe('no-cache');
    });

    it('rota de API inexistente RESPONDE (antes ficava pendurada) e nunca devolve o shell', async () => {
        const res = await fetch(`${base}/api/rota-que-nao-existe`);
        // Sem Mongo no teste, a guarda de disponibilidade responde 503 antes de
        // chegar no fallback; com banco de pé o fallback devolve 404. O que vale
        // como contrato é o que era o bug: a requisição termina com erro e o
        // cliente nunca recebe HTML da SPA no lugar de uma resposta de API.
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.headers.get('content-type') || '').not.toContain('text/html');
    });
});

/**
 * Orçamento de corpo do suporte.
 *
 * O app parseia JSON com teto de 1mb. O ticket de suporte é a única rota que
 * recebe imagem no corpo, e o teto global rejeitava o anexo com 413 ANTES de
 * qualquer rota rodar — o usuário via "não foi possível" e nada no servidor
 * registrava o motivo. O parser dedicado de 3mb do `/api/support` é o que
 * conserta isso, e só um teste no nível do HTTP consegue vê-lo.
 */
describe('corpo do ticket de suporte', () => {
    // ~2,5MB: três anexos no teto (900KB cada) mais o texto. Sem Mongo o app
    // responde 503 na guarda de disponibilidade; com banco de pé responderia 401
    // por falta de token. O que se afirma aqui é só uma coisa — NÃO é 413.
    const corpoGrande = JSON.stringify({
        category: 'BUG',
        subject: 'Print grande',
        body: 'x'.repeat(50),
        attachments: [`data:image/png;base64,${'A'.repeat(2_500_000)}`],
    });

    it('aceita o payload de três anexos sem devolver 413', async () => {
        const res = await fetch(`${base}/api/support/tickets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: corpoGrande,
        });

        expect(res.status).not.toBe(413);
    });

    it('e o resto da API continua em 1mb — o teto maior é só do suporte', async () => {
        const res = await fetch(`${base}/api/wallet/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: corpoGrande,
        });

        expect(res.status).toBe(413);
    });
});
