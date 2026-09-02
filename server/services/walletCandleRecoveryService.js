import logger from '../config/logger.js';
import UserAsset from '../models/UserAsset.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { loadClosesForDay } from '../utils/dayCloses.js';
import { findTreasuryPu } from '../utils/fixedIncome.js';
import { brazilDayKey, isBrBusinessDay } from '../utils/walletSnapshot.js';
import { financialService } from './financialService.js';
import { loadTreasuryPricing } from './treasuryPriceService.js';
import { ensureWalletDayCandles } from './walletDayCandleService.js';

const NON_MARKET_TYPES = ['CASH', 'FIXED_INCOME'];

/** Dia civil imediatamente anterior, sem depender do fuso da máquina. */
export const previousDayKey = (dayStr) => {
    const date = new Date(`${dayStr}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
};

/**
 * Reconstrói o histórico das carteiras afetadas até `dayStr`. Compartilhado
 * pelas duas reconciliações (candle tardio e PU tardio do Tesouro): as duas
 * corrigem o MESMO snapshot e nunca devem divergir na forma de reescrevê-lo.
 */
const rebuildAffectedWallets = async (affected, dayStr, tag) => {
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
            logger.error(`[${tag}] Reconciliação do snapshot ${wallet} @ ${dayStr}: ${error.message}`);
        }
    }
    return { rebuilt, failed };
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

    const closeMap = await loadClosesForDay(eligible, dayStr);
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

    const { rebuilt, failed } = await rebuildAffectedWallets(affected, dayStr, 'DayCandle');

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

/**
 * Segunda passagem do fechamento do Tesouro Direto.
 *
 * O Tesouro publica o PU da Data Base do dia D só no dia D+1 (~10:20), e a
 * ingestão roda 12:30. O snapshot das 23:59 do dia D, portanto, NUNCA enxerga o
 * PU do próprio dia: ele marca o título pelo último ponto disponível, que é o de
 * D-1. Qualquer recomputação posterior — o rebuild, e a âncora do "início do
 * dia" no KPI ao vivo — resolve o PU de D e chega a outro número.
 *
 * É o mesmo defeito que a âncora de candle resolveu, sobrevivendo aqui porque a
 * série de PU, ao contrário do candle, NÃO é imutável: um ponto novo aparece
 * depois que o snapshot já foi gravado. Medido em 31/08/2026 numa carteira com
 * R$ 836 em Tesouro: R$ 838,01 pelo PU de 28/08 contra R$ 836,24 pelo de 31/08 —
 * R$ 1,77 de divergência num único dia, contra os R$ 0,02 de resíduo do resto
 * da carteira.
 *
 * A correção é a mesma da recuperação de candle: quando o dado tardio chega,
 * reconstrói o snapshot daquele dia. Só as carteiras que detêm um título cujo PU
 * do dia REALMENTE chegou entram no rebuild — sem ponto exato para o dia, não há
 * o que reconciliar e a passagem sai sem escrever nada.
 */
export const reconcileTreasurySnapshot = async ({ now = new Date(), targetDay = null } = {}) => {
    const todayKey = brazilDayKey(now);
    const dayStr = targetDay || previousDayKey(todayKey);
    if (!isBrBusinessDay(dayStr)) {
        return { status: 'SKIPPED', day: dayStr, resolved: 0, rebuilt: 0, failed: 0 };
    }

    const holdings = await UserAsset.find({ type: 'FIXED_INCOME', quantity: { $gt: 0 } })
        .select('ticker type quantity maturityDate fixedIncomeIndex user wallet').lean();
    if (holdings.length === 0) {
        return { status: 'SKIPPED', day: dayStr, resolved: 0, rebuilt: 0, failed: 0 };
    }

    const pricing = await loadTreasuryPricing(holdings);
    const affected = new Map();
    const tickers = new Set();
    for (const asset of holdings) {
        if (!asset.wallet || !asset.user) continue;
        const history = pricing.historyFor(asset);
        const hit = history ? findTreasuryPu(history, dayStr) : null;
        // Ponto EXATO do dia. Um PU anterior é o que o snapshot já usou — nada
        // mudou e reconstruir seria trabalho à toa.
        if (!hit || hit.point.date !== dayStr) continue;
        tickers.add(asset.ticker);
        affected.set(String(asset.wallet), { wallet: asset.wallet, user: asset.user });
    }

    if (affected.size === 0) {
        return { status: 'SUCCESS', day: dayStr, resolved: 0, rebuilt: 0, failed: 0 };
    }

    const { rebuilt, failed } = await rebuildAffectedWallets(affected, dayStr, 'TreasuryPU');

    logger.info('[TreasuryPU] Snapshot anterior reconciliado após publicação do PU oficial', {
        day: dayStr,
        tickers: [...tickers],
        resolved: tickers.size,
        rebuilt,
        failed,
    });

    return {
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        day: dayStr,
        resolved: tickers.size,
        rebuilt,
        failed,
        tickers: [...tickers],
    };
};

export const walletCandleRecoveryService = { reconcilePreviousWalletSnapshot, reconcileTreasurySnapshot };
