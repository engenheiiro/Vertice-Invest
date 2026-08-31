/**
 * Painel do funil comercial (Admin).
 *
 * Leitura agregada: nunca devolve linha de usuário, só contagem por coorte,
 * origem e plano. O painel serve para decidir preço e canal, não para olhar
 * conta de gente — e um endpoint que devolvesse a lista viraria, na prática, um
 * exportador de base atrás de uma tela de admin.
 */
import { getFunnelReport, isDatabaseReady, logFunnelSnapshot } from '../services/funnelService.js';

/** GET /api/admin/funnel?months=12 */
export const getFunnel = async (req, res, next) => {
    try {
        if (!isDatabaseReady()) {
            return res.status(503).json({ message: 'Banco indisponível — o funil é lido do banco, não há cache.' });
        }

        const report = await getFunnelReport({ months: req.query.months });
        logFunnelSnapshot(report);
        res.json(report);
    } catch (error) {
        next(error);
    }
};
