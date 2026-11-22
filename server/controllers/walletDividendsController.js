// Proventos, extrato de caixa e rotas de snapshot (admin). Extraído de walletController.js.
import Wallet from '../models/Wallet.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeAdd, safeMult, safeDiv, QUANTITY_EPSILON } from '../utils/mathUtils.js';
import { toDateKey, startOfDay } from '../utils/dateUtils.js';
import { brazilToday } from '../utils/fixedIncome.js';
import { resolveTransactionCurrency, needsCurrencyFallback } from '../utils/assetCurrency.js';
import { allocationBucket } from '../utils/assetAllocation.js';
import { cashFlowTickerCondition } from '../utils/cashFlowFilter.js';
import logger from '../config/logger.js';
import { runDailySnapshot } from '../services/schedulerService.js';

// Throttle do self-heal de dividendos (1h por usuário) — evita re-scraping a
// cada poll do Cofre enquanto os dados ainda estão zerados.
const DIVIDEND_HEAL_TTL = 60 * 60 * 1000;
const dividendHealAt = new Map();

// (F9) Expurgo oportunístico: sem isto o Map cresce 1 entrada por usuário para
// sempre (vazamento lento). Remove marcas de heal já expiradas quando o Map
// passa de um teto — barato e limita o uso de memória do processo.
const DIVIDEND_HEAL_MAX = 50_000;
const pruneDividendHeal = () => {
    if (dividendHealAt.size < DIVIDEND_HEAL_MAX) return;
    const cutoff = Date.now() - DIVIDEND_HEAL_TTL;
    for (const [uid, ts] of dividendHealAt) if (ts < cutoff) dividendHealAt.delete(uid);
};

/**
 * Proventos da carteira (histórico mensal, provisionados, yield on cost, meta).
 * Puro leitura — o self-heal fica no handler autenticado de propósito: um
 * visitante do link público não deve disparar sincronização em background.
 */
export const buildWalletDividendsPayload = async (userId, walletId) => {
        // Meta de renda passiva é por carteira (Fase 2) — busca dedicada em Wallet,
        // em paralelo com o cálculo de proventos.
        const [data, walletDoc, accrued] = await Promise.all([
            financialService.calculateUserDividends(userId, walletId),
            Wallet.findById(walletId).select('targetMonthlyDividendIncome').lean(),
            // A MESMA soma do card "Prov. Acumulados", quebrada em pago e a pagar.
            // Vai junto para que a tela de Proventos consiga explicar por que o
            // gráfico de pagamentos mostra menos que o card, em vez de deixar o
            // usuário concluir que um dos dois está errado.
            financialService.accrueDividendsByTicker(userId, walletId, toDateKey(brazilToday())),
        ]);
        const history = Array.from(data.dividendMap.entries()).map(([month, val]) => ({ month, value: val.total, breakdown: val.breakdown })).sort((a, b) => a.month.localeCompare(b.month));

        // Meta é MENSAL → `current` precisa ser uma grandeza mensal, nunca o
        // acumulado vitalício (`totalAllTime`), senão a barra estoura em 100%.
        // Espelha o que o card exibe (displayDividends): soma das provisões do
        // mês corrente quando houver, senão o fluxo mensal projetado.
        const target = walletDoc?.targetMonthlyDividendIncome || 0;
        const provisionedSum = (data.provisioned || []).reduce((acc, p) => safeAdd(acc, p.amount || 0), 0);
        const current = provisionedSum > 0 ? provisionedSum : data.projectedMonthly;
        const goal = {
            target,
            current,
            progressPercent: target > 0 ? Math.min(100, safeDiv(safeMult(current, 100), target)) : null,
        };

        return {
            history,
            provisioned: data.provisioned,
            totalAllTime: data.totalAllTime,
            projectedMonthly: data.projectedMonthly,
            yieldOnCost: data.yieldOnCost,
            // `total` é, por construção, o mesmo número do card; `paid`/`pending` o
            // quebram sem recalcular nada por fora.
            accrued: { total: accrued.total, paid: accrued.paid, pending: accrued.pending },
            goal,
        };
};

export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const data = await buildWalletDividendsPayload(userId, walletId);
        res.json(data);

        // Self-heal: se o usuário tem ativos pagadores mas TUDO está zerado, é
        // sinal de que faltou sincronizar proventos e/ou popular dy. Dispara em
        // background (sem travar a resposta) sincronização de DividendEvent +
        // refresh de fundamentos (dy/preço). Throttle por usuário evita repetição.
        const isEmpty = data.totalAllTime === 0 && data.projectedMonthly === 0 && (data.provisioned?.length || 0) === 0;
        if (isEmpty) {
            const last = dividendHealAt.get(userId) || 0;
            if (Date.now() - last > DIVIDEND_HEAL_TTL) {
                pruneDividendHeal();
                dividendHealAt.set(userId, Date.now());
                (async () => {
                    try {
                        const eligible = await UserAsset.find({ user: userId, wallet: walletId, quantity: { $gt: QUANTITY_EPSILON } }).select('ticker type').lean();
                        const payers = eligible.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
                        if (payers.length === 0) return;
                        await marketDataService.refreshFundamentals(payers.map(a => a.ticker));
                        await financialService.syncDividends(payers.map(a => ({ ticker: a.ticker, type: a.type })));
                        logger.info(`[Dividends] Self-heal concluído p/ ${userId} (${payers.length} ativos).`);
                    } catch (e) {
                        logger.warn(`[Dividends] Self-heal falhou p/ ${userId}: ${e.message}`);
                    }
                })();
            }
        }
    } catch (error) { next(error); }
};

/** Extrato paginado (aba Extrato) — compartilhado com a rota pública. */
export const buildCashFlowPayload = async (userId, walletId, { page = 1, limit = 20, filterType } = {}) => {
        // UserAsset é a fonte autoritativa da classe econômica. Isso também cobre
        // ETFs por exposição e Renda Fixa marcada como Reserva separada.
        const portfolioAssets = await UserAsset.find({ user: userId, wallet: walletId })
            .select('ticker name type currency allocationClass isReserve usSubType')
            .lean();
        const assetByTicker = new Map(portfolioAssets.map(a => [a.ticker, a]));
        const assetClassByTicker = new Map(portfolioAssets.map(a => [a.ticker, allocationBucket(a)]));
        const reserveAssets = portfolioAssets.filter(a => allocationBucket(a) === 'CASH');
        const cashNameByTicker = new Map(reserveAssets.map(a => [a.ticker, a.name || 'Reserva']));

        const query = { user: userId, wallet: walletId };
        const tickerCondition = cashFlowTickerCondition(portfolioAssets, filterType);
        if (tickerCondition) query.ticker = tickerCondition;
        const transactions = await AssetTransaction.find(query).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
        const total = await AssetTransaction.countDocuments(query);

        // Moeda: `price`/`totalValue` são gravados na moeda NATIVA do ativo (US$ para
        // STOCK_US/CRYPTO), então sem isso o extrato exibia US$ 400 como "R$ 400,00".
        // O campo é gravado na criação desde a migração, e a busca de posições só
        // acontece se ESTA PÁGINA tiver lançamento legado sem moeda — com a base
        // migrada, custo zero. O escopo é limitado aos tickers da página (≤ limit),
        // então nem uma carteira gigante amplia a consulta. Continua auto-curável:
        // se dado legado reaparecer (restore de backup antigo), o fallback volta
        // sozinho sem precisar rodar o backfill de novo.
        const legacyTickers = [...new Set(transactions.filter(needsCurrencyFallback).map(t => t.ticker))]
            .filter(ticker => !assetByTicker.has(ticker));
        if (legacyTickers.length > 0) {
            const legacyAssets = await UserAsset.find({
                user: userId, wallet: walletId, ticker: { $in: legacyTickers },
            }).select('ticker type currency').lean();
            legacyAssets.forEach(a => assetByTicker.set(a.ticker, a));
        }

        return {
            transactions: transactions.map(t => {
                const isCashOp = cashNameByTicker.has(t.ticker);
                return {
                    ...t.toObject(),
                    isCashOp,
                    cashName: isCashOp ? cashNameByTicker.get(t.ticker) : undefined,
                    assetClass: assetClassByTicker.get(t.ticker),
                    assetType: assetByTicker.get(t.ticker)?.type,
                    // Gravada > posição atual > BRL.
                    currency: resolveTransactionCurrency(t, assetByTicker.get(t.ticker)),
                };
            }),
            pagination: { total, hasMore: page * limit < total }
        };
};

export const getCashFlow = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, filterType } = req.query;
        res.json(await buildCashFlowPayload(req.user.id, req.walletId, { page, limit, filterType }));
    } catch (error) { next(error); }
};

export const runCorporateAction = async (req, res, next) => {
    try {
        res.json({ message: "Comando recebido.", details: { updates: 0 } });
    } catch (error) { next(error); }
};

export const fixWalletSnapshots = async (req, res, next) => {
    try {
        const deletedCount = await WalletSnapshot.deleteMany({
            $or: [{ quotaPrice: { $lte: 0.1 } }, { quotaPrice: { $gte: 1000000 } }]
        });
        
        // Fase 2: agrupa por CARTEIRA (não mais por usuário) — cada carteira tem
        // sua própria cadeia de cotas/TWRR independente.
        const wallets = await WalletSnapshot.distinct('wallet');
        let resetDeletions = 0;

        for (const walletId of wallets) {
            const snaps = await WalletSnapshot.find({ wallet: walletId }).sort({ date: 1 });
            const toDelete = [];
            for (let i = 1; i < snaps.length; i++) {
                const prev = snaps[i-1];
                const curr = snaps[i];
                if (Math.abs(curr.quotaPrice - 100) < 0.01 && Math.abs(prev.quotaPrice - 100) > 5) {
                    toDelete.push(curr._id);
                }
            }
            if (toDelete.length > 0) {
                await WalletSnapshot.deleteMany({ _id: { $in: toDelete } });
                resetDeletions += toDelete.length;
            }
        }

        res.json({ 
            message: "Limpeza de snapshots concluída.", 
            deletedZeros: deletedCount.deletedCount,
            deletedResets: resetDeletions
        });
    } catch (error) {
        next(error);
    }
};

export const getSnapshotHealth = async (req, res, next) => {
    try {
        const today = startOfDay(new Date());

        // Fase 2: cobertura esperada é 1 snapshot/dia por CARTEIRA (não por usuário).
        const totalWallets = await Wallet.countDocuments({});
        const snapshotsToday = await WalletSnapshot.countDocuments({ date: { $gte: today } });
        const lastRun = await WalletSnapshot.findOne().sort({ createdAt: -1 }).select('createdAt');

        res.json({
            totalWallets,
            snapshotsToday,
            coverage: totalWallets > 0 ? ((snapshotsToday / totalWallets) * 100).toFixed(1) + '%' : '0%',
            lastRun: lastRun?.createdAt,
            status: snapshotsToday > (totalWallets * 0.9) ? 'HEALTHY' : 'WARNING'
        });
    } catch (error) {
        next(error);
    }
};

// NOVO: Ação Manual de Snapshot (Admin)
export const forceSnapshot = async (req, res, next) => {
    try {
        const { force } = req.body;
        // Chama a função isolada do scheduler
        const result = await runDailySnapshot(!!force);
        
        if (result.status === 'ERROR') throw new Error(result.error);
        if (result.status === 'SKIPPED') {
            return res.status(200).json({ message: "Snapshot ignorado (Feriado ou Fim de semana). Use force=true para obrigar." });
        }
        
        res.json({ message: "Snapshot executado com sucesso.", stats: result.stats });
    } catch (error) {
        next(error);
    }
};
