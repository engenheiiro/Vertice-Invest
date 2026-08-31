/**
 * Onda 3 do plano comercial (30/08/2026) — "Metas Financeiras Limitadas" (Free)
 * × "Ilimitadas" (Essential+). O teto vive em LIMITS_CONFIG.goals e é aplicado
 * na criação; aqui só a decisão de barrar/deixar passar, sem tocar no cálculo
 * de projeção (o caminho feliz para antes de qualquer conta pesada).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/treasuryPriceService.js', () => ({ loadTreasuryPricing: vi.fn() }));
vi.mock('../models/InvestmentGoal.js', () => ({
    default: { countDocuments: vi.fn(), create: vi.fn(), find: vi.fn() },
}));
vi.mock('../models/GoalJourney.js', () => ({ default: {} }));
vi.mock('../models/GoalContribution.js', () => ({ default: {} }));
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));

const { createGoal } = await import('../controllers/goalsController.js');
const InvestmentGoal = (await import('../models/InvestmentGoal.js')).default;
const { LIMITS_CONFIG } = await import('../config/subscription.js');

const mockRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

const attemptCreate = async (plan, total, role = 'USER') => {
    InvestmentGoal.countDocuments.mockResolvedValue(total);
    const req = {
        user: { id: 'u1', plan, role },
        walletId: 'w1',
        body: { name: 'Aposentadoria', targetAmount: 100000 },
    };
    const res = mockRes();
    const next = vi.fn();
    await createGoal(req, res, next);
    return { res, next };
};

beforeEach(() => vi.clearAllMocks());

describe('createGoal — teto de metas por plano', () => {
    it('o Free tem teto e o Essential em diante é ilimitado (contrato do card)', () => {
        expect(LIMITS_CONFIG.goals.GUEST).toBe(3);
        for (const plan of ['ESSENTIAL', 'PRO', 'ELITE', 'BLACK']) {
            expect(LIMITS_CONFIG.goals[plan]).toBe(9999);
        }
    });

    it('bloqueia o Free na quarta meta com 403 e requiredPlan ESSENTIAL', async () => {
        const { res } = await attemptCreate('GUEST', 3);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requiredPlan: 'ESSENTIAL' }));
        expect(InvestmentGoal.create).not.toHaveBeenCalled();
    });

    // Fail-closed: plano ausente/desconhecido é tratado como Free. Um plano novo
    // que ninguém lembrou de mapear não pode virar meta ilimitada por omissão.
    it.each([undefined, 'PLANO_QUE_NAO_EXISTE'])('trata o plano %s como Free', async (plan) => {
        const { res } = await attemptCreate(plan, 3);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('deixa o Essential passar muito além do teto do Free', async () => {
        const { res } = await attemptCreate('ESSENTIAL', 50);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('ADMIN não tem teto (QA/suporte)', async () => {
        const { res } = await attemptCreate('GUEST', 99, 'ADMIN');
        expect(res.status).not.toHaveBeenCalledWith(403);
    });
});
