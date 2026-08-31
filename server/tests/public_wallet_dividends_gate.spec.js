/**
 * Onda 3 do plano comercial (30/08/2026) — Proventos é módulo ESSENTIAL+.
 *
 * O gate da rota privada (requireDividendsPlan) não bastaria: publicar a própria
 * carteira e abrir o próprio link seria um desvio de uma linha em torno dele.
 * No link público quem paga é o DONO, não o visitante — é o plano dele que decide.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({ withScope: vi.fn(), captureException: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/Wallet.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../controllers/walletController.js', () => ({
    buildWalletPayload: vi.fn(() => Promise.resolve({ kpis: { totalEquity: 1000 } })),
    buildWalletHistoryPayload: vi.fn(() => Promise.resolve([])),
    buildWalletPerformancePayload: vi.fn(() => Promise.resolve({})),
    buildWalletDividendsPayload: vi.fn(() => Promise.resolve({ history: [], provisioned: [], totalAllTime: 42 })),
    buildCashFlowPayload: vi.fn(() => Promise.resolve({})),
}));

const Wallet = (await import('../models/Wallet.js')).default;
const User = (await import('../models/User.js')).default;
const { buildWalletDividendsPayload } = await import('../controllers/walletController.js');
const { getPublicWalletDividends } = await import('../controllers/publicWalletController.js');

const TOKEN = 'x'.repeat(32);

const mockRes = () => {
    const res = {};
    res.set = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

const fetchAsOwner = async (ownerPlan) => {
    Wallet.findOne.mockReturnValue({
        select: vi.fn(() => ({
            lean: vi.fn(() => Promise.resolve({
                _id: 'w1', user: 'u1', name: 'Carteira', publicShowValues: true,
            })),
        })),
    });
    User.findById.mockReturnValue({
        select: vi.fn(() => ({ lean: vi.fn(() => Promise.resolve(ownerPlan === null ? null : { plan: ownerPlan, role: 'USER' })) })),
    });

    const res = mockRes();
    const next = vi.fn();
    await getPublicWalletDividends({ params: { token: TOKEN }, query: {} }, res, next);
    return { res, next };
};

beforeEach(() => vi.clearAllMocks());

describe('GET /public/wallet/:token/dividends — gate pelo plano do dono', () => {
    it.each(['ESSENTIAL', 'PRO', 'ELITE', 'BLACK'])('publica os proventos quando o dono é %s', async (plan) => {
        const { res, next } = await fetchAsOwner(plan);

        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalled();
        expect(buildWalletDividendsPayload).toHaveBeenCalled();
    });

    // Fail-closed nos dois sentidos: dono no Free e dono que sumiu do banco.
    it.each(['GUEST', null])('recusa com 403 quando o dono é %s (sem montar o payload)', async (plan) => {
        const { res, next } = await fetchAsOwner(plan);

        expect(res.json).not.toHaveBeenCalled();
        expect(buildWalletDividendsPayload).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    });

    it('a recusa não vaza o plano de quem publicou', async () => {
        const { next } = await fetchAsOwner('GUEST');
        const [erro] = next.mock.calls[0];

        expect(erro.message).not.toMatch(/GUEST|Free|plano/i);
    });
});
