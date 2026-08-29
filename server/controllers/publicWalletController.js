
import * as Sentry from '@sentry/node';
import Wallet from '../models/Wallet.js';
import User from '../models/User.js';
import {
    buildWalletPayload,
    buildWalletHistoryPayload,
    buildWalletPerformancePayload,
    buildWalletDividendsPayload,
    buildCashFlowPayload,
} from './walletController.js';
import {
    buildPublicScale, maskWalletPayload, maskHistory,
    maskPerformance, maskDividends, maskCashFlow,
} from '../utils/publicWalletMask.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';

/**
 * (C4) Carteira pública — visão SOMENTE-LEITURA, sem autenticação, resolvida por
 * um token opt-in (Wallet.publicToken).
 *
 * O visitante vê a MESMA página Carteira do dono (mesmos componentes, mesmos
 * números): cada rota daqui é uma casca fina sobre o builder que a rota privada
 * correspondente usa — buildWalletPayload, buildWalletPerformancePayload,
 * buildWalletDividendsPayload, buildCashFlowPayload. Não existe segunda
 * implementação que possa divergir.
 *
 * O que muda em relação à rota privada:
 *   - nada é gravado e nenhuma rotina de background é disparada;
 *   - identificadores internos (user, wallet, assetId) são removidos;
 *   - as metas da Carteira Ideal não são publicadas (o visitante vê a carteira
 *     REAL, não o plano do dono);
 *   - com `publicShowValues` desligado, todo R$ sai NORMALIZADO por
 *     publicWalletMask (patrimônio = 100) e quantidade/preços saem zerados.
 */

// Token gerado com randomBytes(24) → ~32 chars base64url. Guard barato contra
// varredura por strings curtas antes de tocar o banco.
const resolvePublicWallet = async (token) => {
    if (!token || typeof token !== 'string' || token.length < 16) return null;
    return Wallet.findOne({ publicToken: token, isPublic: true })
        .select('_id user name publicShowValues').lean();
};

/**
 * Casca comum das rotas públicas: resolve o token, monta a escala de máscara e
 * entrega (wallet, scale) ao builder. Erro nunca vaza detalhe de existência —
 * token inválido e carteira despublicada respondem o mesmo 404.
 */
const publicRoute = (build) => async (req, res, next) => {
    try {
        const wallet = await resolvePublicWallet(req.params.token);
        if (!wallet) return next(AppError.notFound('Carteira pública não encontrada.'));

        const userId = String(wallet.user);
        const walletId = String(wallet._id);
        const payload = await build({ req, wallet, userId, walletId });

        res.set('Cache-Control', 'public, max-age=60'); // teaser: cache de 1min
        res.json(payload);
    } catch (error) {
        // (E5) Erros da rota pública ganham tag própria no Sentry — além do
        // handler global — para alerta/segmentação de uma superfície não-autenticada.
        if (process.env.SENTRY_DSN) {
            Sentry.withScope((scope) => {
                scope.setTag('route', 'public_wallet');
                Sentry.captureException(error);
            });
        }
        logger.error(`[PublicWallet] Falha ao resolver carteira pública: ${error.message}`);
        next(error);
    }
};

/**
 * A escala depende do patrimônio, que só o payload da carteira conhece — e as
 * abas precisam do MESMO fator, senão cada uma normalizaria por uma base
 * diferente e os números não conversariam entre si.
 *
 * O patrimônio fica memoizado por carteira pelo mesmo minuto do Cache-Control:
 * sem isso cada aba do link refaria o payload inteiro (cotações, snapshots,
 * métricas de risco) só para descobrir o divisor.
 */
const EQUITY_TTL_MS = 60_000;
const EQUITY_CACHE_MAX = 500;
const equityCache = new Map();

const cachedEquity = async (userId, walletId) => {
    const hit = equityCache.get(walletId);
    if (hit && Date.now() - hit.at < EQUITY_TTL_MS) return hit.equity;
    const payload = await buildWalletPayload(userId, walletId);
    return rememberEquity(walletId, payload?.kpis?.totalEquity);
};

const rememberEquity = (walletId, equity) => {
    // Descarte simples por inserção mais antiga: o mapa é um cache, não um índice.
    if (equityCache.size >= EQUITY_CACHE_MAX) equityCache.delete(equityCache.keys().next().value);
    equityCache.set(walletId, { equity, at: Date.now() });
    return equity;
};

const scaleFor = async (wallet, userId, walletId) => {
    if (wallet.publicShowValues) return buildPublicScale({ showValues: true });
    return buildPublicScale({ showValues: false, totalEquity: await cachedEquity(userId, walletId) });
};

/** GET /public/wallet/:token — carteira (ativos + KPIs) + identidade do link. */
export const getPublicWallet = publicRoute(async ({ wallet, userId, walletId }) => {
    const [payload, owner] = await Promise.all([
        buildWalletPayload(userId, walletId),
        User.findById(userId).select('name').lean(),
    ]);

    // Esta rota já pagou pelo payload: alimenta o cache que as abas consultam.
    rememberEquity(walletId, payload?.kpis?.totalEquity);
    const scale = buildPublicScale({
        showValues: !!wallet.publicShowValues,
        totalEquity: payload?.kpis?.totalEquity,
    });

    return {
        // Só o primeiro nome do dono (link público por escolha explícita dele).
        wallet: { name: wallet.name, ownerFirstName: (owner?.name || '').trim().split(/\s+/)[0] || null },
        showValues: scale.showValues,
        ...maskWalletPayload(scale, payload),
    };
});

export const getPublicWalletHistory = publicRoute(async ({ wallet, userId, walletId }) => {
    const [snapshots, scale] = await Promise.all([
        buildWalletHistoryPayload(userId, walletId),
        scaleFor(wallet, userId, walletId),
    ]);
    return maskHistory(scale, snapshots.map(({ user, wallet: _w, ...rest }) => rest));
});

export const getPublicWalletPerformance = publicRoute(async ({ wallet, userId, walletId }) => {
    const [performance, scale] = await Promise.all([
        buildWalletPerformancePayload(userId, walletId),
        scaleFor(wallet, userId, walletId),
    ]);
    return maskPerformance(scale, performance);
});

export const getPublicWalletDividends = publicRoute(async ({ wallet, userId, walletId }) => {
    const [dividends, scale] = await Promise.all([
        buildWalletDividendsPayload(userId, walletId),
        scaleFor(wallet, userId, walletId),
    ]);
    return maskDividends(scale, dividends);
});

export const getPublicWalletCashFlow = publicRoute(async ({ req, wallet, userId, walletId }) => {
    // Paginação vem da querystring do visitante: normalizada e com teto, para
    // que um link público não vire um dump paginado arbitrário.
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const filterType = ['CASH', 'TRADE'].includes(req.query.filterType) ? req.query.filterType : 'ALL';

    const [cashFlow, scale] = await Promise.all([
        buildCashFlowPayload(userId, walletId, { page, limit, filterType }),
        scaleFor(wallet, userId, walletId),
    ]);

    // Remove identificadores internos ANTES da máscara: `user` é o id do dono e
    // não pode existir numa resposta sem autenticação, com ou sem valores.
    const sanitized = {
        ...cashFlow,
        transactions: (cashFlow.transactions || []).map(({ user, wallet: _w, assetId, ...rest }) => rest),
    };
    return maskCashFlow(scale, sanitized);
});
