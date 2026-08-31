import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Segredos de brinquedo: o app valida a presença deles no import. Nenhum token é
// emitido aqui — o teste só olha headers e status do shell.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-para-contrato-do-shell';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-para-contrato';
// O SDK do Gemini exige chave já na construção (import de aiEnhancementService).
process.env.API_KEY = process.env.API_KEY || 'test-gemini-key';

// O scheduler registra cron de verdade no import do app — nunca num teste.
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
