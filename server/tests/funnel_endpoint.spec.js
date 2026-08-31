import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Endpoint do funil — quem pode ler e o que sai.
 *
 * Duas garantias: a porta é de admin (o funil expõe receita e base de clientes),
 * e a resposta é AGREGADA. Um endpoint que devolvesse linha de usuário seria,
 * na prática, um exportador da base atrás de uma tela bonita.
 */

vi.mock('../services/funnelService.js', () => ({
    getFunnelReport: vi.fn(),
    isDatabaseReady: vi.fn(() => true),
    logFunnelSnapshot: vi.fn(),
}));

const funnelService = await import('../services/funnelService.js');
const { getFunnel } = await import('../controllers/funnelController.js');
const adminRoutes = (await import('../routes/adminRoutes.js')).default;

const response = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

const chamar = async (query = {}) => {
    const res = response();
    const next = vi.fn();
    await getFunnel({ query }, res, next);
    return { res, next };
};

beforeEach(() => {
    vi.clearAllMocks();
    funnelService.isDatabaseReady.mockReturnValue(true);
    funnelService.getFunnelReport.mockResolvedValue({
        windowMonths: 12,
        cohorts: [],
        revenue: { mrr: 0, subscribers: 0 },
    });
});

describe('Porta de entrada', () => {
    const camadas = (caminho) => {
        const rota = adminRoutes.stack.find((l) => l.route?.path === caminho);
        return rota.route.stack.map((s) => s.name);
    };

    it('exige autenticação antes de qualquer rota', () => {
        expect(adminRoutes.stack[0].name).toBe('authenticateToken');
        expect(adminRoutes.stack[0].route).toBeUndefined();
    });

    it('exige admin no funil', () => {
        // Sem isto, qualquer conta logada leria MRR, base e origem dos clientes.
        expect(camadas('/funnel')).toContain('requireAdmin');
    });

    it('mantém a ordem do projeto: limitador antes do guarda de admin', () => {
        const nomes = camadas('/funnel');
        expect(nomes.indexOf('rateLimit')).toBeLessThan(nomes.indexOf('requireAdmin'));
    });
});

describe('Resposta', () => {
    it('repassa a janela pedida', async () => {
        await chamar({ months: '6' });

        expect(funnelService.getFunnelReport).toHaveBeenCalledWith({ months: '6' });
    });

    it('avisa quando o banco está fora, em vez de estourar 500', async () => {
        // O funil não tem cache: é lido do banco a cada abertura, de propósito.
        funnelService.isDatabaseReady.mockReturnValue(false);
        const { res, next } = await chamar();

        expect(res.statusCode).toBe(503);
        expect(next).not.toHaveBeenCalled();
        expect(funnelService.getFunnelReport).not.toHaveBeenCalled();
    });

    it('não devolve identificação de usuário', async () => {
        const { res } = await chamar();
        const corpo = JSON.stringify(res.body);

        for (const campo of ['email', 'cpf', 'password', '_id', 'name']) {
            expect(corpo, `${campo} não pode aparecer no funil`).not.toContain(campo);
        }
    });

    it('deixa erro real subir para o tratador central', async () => {
        funnelService.getFunnelReport.mockRejectedValue(new Error('falha'));
        const { next } = await chamar();

        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
});
