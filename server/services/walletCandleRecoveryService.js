import logger from '../config/logger.js';
import AssetHistory from '../models/AssetHistory.js';
import UserAsset from '../models/UserAsset.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { brazilDayKey, isBrBusinessDay } from '../utils/walletSnapshot.js';
import { financialService } from './financialService.js';
import { ensureWalletDayCandles } from './walletDayCandleService.js';

const NON_MARKET_TYPES = ['CASH', 'FIXED_INCOME'];

/** Dia civil imediatamente anterior, sem depender do fuso da máquina. */
export const previousDayKey = (dayStr) => {
    const date = new Date(`${dayStr}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
};

const loadDayCloses = async (assetRefs, dayStr) => {
    const keys = [...new Set(assetRefs
        .map((asset) => historyStorageKey(asset.ticker, asset.type))
        .filter(Boolean))];
    if (keys.length === 0) return new Map();

    const rows = await AssetHistory.aggregate([
        { $match: { ticker: { $in: keys } } },
        {
            $project: {
                ticker: 1,
                candle: {
                    $first: {
                        $filter: {
                            input: { $ifNull: ['$history', []] },
                            as: 'h',
                            cond: { $eq: ['$$h.date', dayStr] },
                        },
                    },
                },
            },
        },
        { $match: { 'candle.close': { $gt: 0 } } },
    ]);
    return new Map(rows.map((row) => [row.ticker, row.candle.close]));
};

/**
 * Segunda passagem do fechamento do último dia encerrado.
 *
 * Às 23:59 o Yahoo pode publicar `close: null` e o arquivo consolidado da B3
 * ainda pode estar marcado como Parcial. O snapshot precisa continuar fail-open
 * naquele instante, mas não pode ficar degradado para sempre. No boot e antes da
 * rotina da manhã, esta passagem tenta novamente o dia anterior, quando o arquivo
 * oficial já está Final. Se algum candle entrou, reconstrói somente as carteiras
 * que detêm o ativo para substituir o snapshot marcado pelo preço do instante.
 *
 * Fim de semana/feriado não participa: `runDailySnapshot` não grava esses dias,
 * então não existe snapshot anterior a reconciliar. A série 24/7 da cripto segue
 * sendo responsabilidade do `timeSeriesWorker`.
 */
export const reconcilePreviousWalletSnapshot = async ({
    now = new Date(),
    targetDay = null,
} = {}) => {
    const todayKey = brazilDayKey(now);
    const dayStr = targetDay || previousDayKey(todayKey);
    if (!isBrBusinessDay(dayStr)) {
        return { status: 'SKIPPED', day: dayStr, recovered: 0, rebuilt: 0, failed: 0 };
    }

    const holdings = await UserAsset.find({
        type: { $nin: NON_MARKET_TYPES },
        quantity: { $gt: 0 },
    }).select('ticker type quantity user wallet').lean();

    const eligible = holdings;
    if (eligible.length === 0) {
        return { status: 'SKIPPED', day: dayStr, recovered: 0, rebuilt: 0, failed: 0 };
    }

    const closeMap = await loadDayCloses(eligible, dayStr);
    const resolved = await ensureWalletDayCandles(eligible, dayStr, closeMap);
    if (resolved.size === 0) {
        return { status: 'SUCCESS', day: dayStr, recovered: 0, rebuilt: 0, failed: 0 };
    }

    // Uma posição pode aparecer em várias carteiras. O rebuild é por carteira e
    // usa a linha do tempo de transações, portanto corrige o snapshot sem assumir
    // que a quantidade atual era a quantidade do fechamento anterior.
    const affected = new Map();
    for (const asset of eligible) {
        const key = historyStorageKey(asset.ticker, asset.type);
        if (!resolved.has(key) || !asset.wallet || !asset.user) continue;
        affected.set(String(asset.wallet), { wallet: asset.wallet, user: asset.user });
    }

    let rebuilt = 0;
    let failed = 0;
    for (const { wallet, user } of affected.values()) {
        try {
            await financialService.rebuildUserHistory(user, wallet, {
                throughDayKey: dayStr,
                source: 'REBUILD',
            });
            rebuilt += 1;
        } catch (error) {
            failed += 1;
            logger.error(`[DayCandle] Reconciliação do snapshot ${wallet} @ ${dayStr}: ${error.message}`);
        }
    }

    const tickers = [...new Set(eligible
        .filter((asset) => resolved.has(historyStorageKey(asset.ticker, asset.type)))
        .map((asset) => asset.ticker))];
    logger.info('[DayCandle] Snapshot anterior reconciliado após publicação tardia do fechamento', {
        day: dayStr,
        tickers,
        recovered: resolved.size,
        rebuilt,
        failed,
    });

    return {
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        day: dayStr,
        recovered: resolved.size,
        rebuilt,
        failed,
        tickers,
    };
};

export const walletCandleRecoveryService = { reconcilePreviousWalletSnapshot };
