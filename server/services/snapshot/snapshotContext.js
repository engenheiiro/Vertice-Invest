// Contexto compartilhado (macro + cotações em lote) de um run de snapshot.
// Saiu de schedulerService.js, que segue re-exportando `loadSnapshotContext`
// pelo ponto de importação histórico (scripts e testes).
import { DEFAULT_SELIC_FALLBACK } from '../../config/financialConstants.js';
import SystemConfig from '../../models/SystemConfig.js';
import UserAsset from '../../models/UserAsset.js';
import { loadCdiCurveForAssets } from '../../utils/cdiCurve.js';
import { loadClosesForDay } from '../../utils/dayCloses.js';
import { brazilDayKey } from '../../utils/walletSnapshot.js';
import { financialService } from '../financialService.js';
import { marketDataService } from '../marketDataService.js';
import { loadTreasuryPricing } from '../treasuryPriceService.js';
import { ensureWalletDayCandles } from '../walletDayCandleService.js';

const positiveOrNull = (value) => (value > 0 ? value : null);

// Taxas da macro: dólar só quando positivo; CDI cai para a SELIC e, sem as
// duas, para o fallback.
const readSnapshotMacro = (sysConfig) => ({
    macroUsdRate: positiveOrNull(sysConfig?.dollar),
    currentCdi: positiveOrNull(sysConfig?.cdi) || positiveOrNull(sysConfig?.selic) || DEFAULT_SELIC_FALLBACK,
    selic: sysConfig?.selic,
    ipca: sysConfig?.ipca,
});

// Regra 13: sem cotação na macro, o câmbio do dia vem da série USD/BRL real;
// sem série, fica AUSENTE (antes era 5,75 fixo, gravado no snapshot) e a
// carteira com dólar não é fotografada (ver persistUserSnapshotForDay).
const resolveDayUsdRate = (macroUsdRate, getUsdRateForDate, dayStr) => (
    macroUsdRate ?? (getUsdRateForDate.hasSeries === true ? getUsdRateForDate(dayStr) : null)
);

// `ensureDayCandles` só é ligado por quem vai GRAVAR o snapshot de hoje: o
// backfill/boot reconstrói a série pelo rebuild (que tem o próprio cache de
// preços) e não deve pagar dezenas de buscas externas a cada reinício.
export const loadSnapshotContext = async (dayStr = brazilDayKey(new Date()), { ensureDayCandles = false } = {}) => {
    const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const { macroUsdRate, currentCdi, selic, ipca } = readSnapshotMacro(sysConfig);
    // A curva viaja DENTRO de macroRates porque `computeEquityAt` já repassa o
    // objeto inteiro a `valueFixedIncomeAsset` — assim snapshot, KPI ao vivo e
    // rebuild leem a mesma taxa por dia sem cada um carregar a série por conta.
    const fixedIncomeAssets = await UserAsset.find({ type: { $in: ['CASH', 'FIXED_INCOME'] } })
        .select('type taxLots startDate').lean();
    const cdiCurve = await loadCdiCurveForAssets(fixedIncomeAssets, { currentRate: currentCdi });
    const macroRates = { cdiRate: currentCdi, selic, ipca, cdiCurve };
    // (F4) Cotações em LOTE, uma vez por run — evita N+1 de getMarketDataByTicker.
    const liveAssets = await UserAsset.find({ type: { $nin: ['CASH', 'FIXED_INCOME'] } }).select('ticker type quantity').lean();
    const priceMap = await marketDataService.getMarketDataMap([...new Set(liveAssets.map((a) => a.ticker))]);
    const closeMap = await loadClosesForDay(liveAssets, dayStr);
    // Antes de marcar o dia, garante o candle de fechamento dos ativos que estão
    // em carteira. Sem isso o fallback abaixo (preço corrente às 23:59) valia para
    // metade do patrimônio, porque a série de AssetHistory atrasa por design.
    if (ensureDayCandles) {
        const resolved = await ensureWalletDayCandles(liveAssets, dayStr, closeMap);
        for (const [key, close] of resolved) closeMap.set(key, close);
    }
    const getUsdRateForDate = await financialService._loadUsdRateResolver(macroUsdRate);
    const usdRate = resolveDayUsdRate(macroUsdRate, getUsdRateForDate, dayStr);
    // Séries de PU do Tesouro, uma vez por run: o snapshot precisa marcar a renda
    // fixa pela MESMA régua do KPI ao vivo, senão o histórico e o card divergem.
    const treasuryAssets = await UserAsset.find({ type: 'FIXED_INCOME' })
        .select('ticker type name maturityDate fixedIncomeIndex')
        .lean();
    const treasuryPricing = await loadTreasuryPricing(treasuryAssets);
    return { usdRate, macroRates, priceMap, closeMap, getUsdRateForDate, treasuryPricing };
};
