
import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import QuantSignal from '../../models/QuantSignal.js';
import SystemConfig from '../../models/SystemConfig.js';
import { externalMarketService } from '../externalMarketService.js';
import { resolveDivergenceOpts, findPivotLows, evaluateDivergence } from './signals/divergence.js';
import { eligibleAssetsFilter, buildHistoryMap, newScanState, scanAsset, persistScan } from './signals/scanner.js';
import { auditSignals } from './signals/backtest.js';

const DEFENSIVE_SECTORS = ['Saneamento', 'Elétricas', 'Seguros', 'Bancos', 'Telecom'];

export const signalEngine = {

    // --- FUNÇÕES MATEMÁTICAS PURAS ---

    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return null;

        let closes = prices.slice(0, period + 1);

        let gains = 0;
        let losses = 0;

        for (let i = 0; i < period; i++) {
            const change = closes[i] - closes[i + 1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }

        // Série PLANA (sem alta nem queda): antes caía no `losses === 0` e devolvia
        // 100 — "sobrecompra máxima" para um ativo que simplesmente não se mexeu
        // (sem negócio, cotação congelada). Sem movimento não há força relativa:
        // o RSI neutro é 50. Só alta e nenhuma queda continua sendo 100.
        if (gains === 0 && losses === 0) return 50;
        if (losses === 0) return 100;

        const rs = gains / losses;
        return 100 - (100 / (1 + rs));
    },

    determineRiskProfile(asset) {
        if (asset.type === 'FII') return 'MODERATE';
        if (asset.type === 'STOCK_US') {
            const defensiveUSSectors = ['Consumer Staples', 'Utilities', 'Healthcare', 'Financials'];
            if (defensiveUSSectors.some(s => (asset.sector || '').includes(s))) return 'DEFENSIVE';
            if (asset.marketCap >= 50_000_000_000) return 'MODERATE';
            return 'BOLD';
        }
        if (DEFENSIVE_SECTORS.includes(asset.sector)) {
            if (asset.debtToEquity > 3.5 && asset.sector !== 'Bancos') return 'MODERATE';
            return 'DEFENSIVE';
        }
        if (asset.marketCap < 2000000000) return 'BOLD';
        return 'MODERATE';
    },

    // --- ANÁLISE DE CORRELAÇÃO (FILTRO MACRO) ---
    async getMacroContext() {
        try {
            const quotes = await externalMarketService.getQuotes(['BZ=F', '^BVSP', '^GSPC']);
            const oil = quotes.find(q => q.ticker === 'BZ=F');
            // getQuotes devolve o símbolo CANÔNICO ('^BVSP'). Comparar com 'BVSP' nunca
            // casava: ibovChange/spxChange eram sempre 0 e o bloqueio de dia de pânico
            // estava morto. Aceita as duas formas.
            const bySym = (sym) => quotes.find(q => String(q.ticker || '').replace(/^\^/, '') === sym);
            const ibov = bySym('BVSP');
            const spx = bySym('GSPC');

            return {
                oilChange: oil ? oil.change : 0,
                ibovChange: ibov ? ibov.change : 0,
                spxChange: spx ? spx.change : 0,
                isCrashDay: ibov ? ibov.change < -2.5 : false,
                isUSCrashDay: spx ? spx.change < -2.5 : false
            };
        } catch {
            logger.warn("⚠️ [SignalEngine] Falha ao obter contexto macro. Assumindo neutro.");
            return { oilChange: 0, ibovChange: 0, spxChange: 0, isCrashDay: false, isUSCrashDay: false };
        }
    },

    isValidCorrelation(ticker, signalType, macroContext, assetType) {
        if (assetType === 'STOCK_US') {
            if (macroContext.isUSCrashDay && signalType !== 'RSI_OVERSOLD') {
                return { valid: false, reason: "S&P 500 em Pânico (SPX < -2.5%)" };
            }
            return { valid: true };
        }

        if (macroContext.isCrashDay && signalType !== 'RSI_OVERSOLD') {
            return { valid: false, reason: "Mercado em Pânico (IBOV < -2.5%)" };
        }

        const oilTickers = ['PETR4', 'PETR3', 'PRIO3', 'RRRP3', 'RECV3', 'ENAT3'];
        if (oilTickers.includes(ticker)) {
            if (macroContext.oilChange < -1.5) {
                return { valid: false, reason: `Petróleo em queda livre (${macroContext.oilChange.toFixed(2)}%)` };
            }
        }

        if (ticker.startsWith('VALE') && macroContext.ibovChange < -2.0) {
            return { valid: false, reason: "Tendência macro negativa forte" };
        }

        return { valid: true };
    },

    // Determina urgência do sinal RSI
    _rsiUrgency(rsi) {
        if (rsi < 20) return 'CRITICAL';
        if (rsi < 30) return 'HIGH';
        return 'MEDIUM';
    },

    // Determina urgência do sinal Deep Value (discount = preço / graham)
    // Threshold ajustado: sinais só gerados para discount < 0.70 (tudo GOLD)
    _grahamUrgency(discount) {
        if (discount < 0.55) return 'CRITICAL';
        if (discount < 0.70) return 'HIGH';
        return 'MEDIUM';
    },

    // Determina urgência da divergência altista pela força da sobrevenda
    // no fundo recente: RSI mais baixo => virada potencialmente mais forte.
    _divergenceUrgency(rsi) {
        if (rsi < 25) return 'CRITICAL';
        if (rsi < 35) return 'HIGH';
        return 'MEDIUM';
    },

    // --- FILTRO POR VOLUME (7.3) ---
    // Estatísticas de volume a partir do histórico (mais recente → mais antigo).
    // `confirmed` exige volume atual >= `multiplier`× a média dos últimos
    // `lookback` pregões. Quando não há dados de volume suficientes (histórico
    // legado, sem o campo), retorna { hasData: false, confirmed: true } para
    // degradar com segurança — o sinal NÃO é bloqueado por ausência de dado.
    _volumeStats(history, multiplier = 1.2, lookback = 20) {
        const volumes = (history || [])
            .map(h => h.volume)
            .filter(v => Number.isFinite(v) && v > 0);

        if (volumes.length < lookback) {
            return { hasData: false, currentVolume: volumes[0] || 0, avgVolume: 0, ratio: null, confirmed: true };
        }

        const avgVolume = volumes.slice(0, lookback).reduce((a, b) => a + b, 0) / lookback;
        const currentVolume = volumes[0] || 0;
        const ratio = avgVolume > 0 ? currentVolume / avgVolume : null;
        const confirmed = ratio !== null ? ratio >= multiplier : true;

        return { hasData: true, currentVolume, avgVolume, ratio, confirmed };
    },

    // --- DETECÇÃO DE DIVERGÊNCIAS (7.2) ---
    // Série de RSI alinhada ao histórico (mais recente → mais antigo).
    // out[i] = RSI "no dia i" (calculado sobre closes[i..i+period]); null onde
    // não há dados suficientes para fechar a janela.
    _rsiSeries(closes, period = 14) {
        const out = new Array(closes.length).fill(null);
        for (let i = 0; i + period < closes.length; i++) {
            out[i] = this.calculateRSI(closes.slice(i), period);
        }
        return out;
    },

    // Divergência altista: o PREÇO faz um fundo mais baixo enquanto o RSI faz
    // um fundo mais ALTO (o momentum de baixa enfraquece) — sinal clássico de
    // possível virada. `closes` ordenado do mais recente para o mais antigo.
    // Retorna detalhes do par de fundos ou null se não houver divergência.
    detectBullishDivergence(closes, period = 14, opts = {}) {
        const o = resolveDivergenceOpts(opts);

        if (!Array.isArray(closes)) return null;
        const minLen = period + o.wing + o.minSeparation + 2;
        if (closes.length < minLen) return null;

        const rsi = this._rsiSeries(closes, period);
        const pivots = findPivotLows(closes, rsi, o.wing, o.maxLookback);
        return evaluateDivergence(closes, rsi, pivots, o);
    },

    // --- SCANNER PRINCIPAL ---

    async runScanner() {
        logger.info("📡 [Radar Alpha] Iniciando varredura (v4.0 - UPSERT + Auto-Invalidação)...");
        const startTime = Date.now();

        const macroContext = await this.getMacroContext();
        if (macroContext.oilChange !== 0) {
            logger.debug(`🌍 [Macro] Petróleo: ${macroContext.oilChange.toFixed(2)}% | IBOV: ${macroContext.ibovChange.toFixed(2)}%`);
        }

        const scan = newScanState();

        try {
            // 1. CARREGAR ATIVOS
            const assets = await MarketAsset.find(eligibleAssetsFilter()).lean();

            if (assets.length === 0) {
                logger.warn("⛔ [Radar Alpha] Nenhum ativo elegível.");
                return { success: true, signals: 0, analyzed: 0 };
            }

            const tickers = assets.map(a => a.ticker);

            // 2. PRE-FETCHING DE HISTÓRICO
            logger.debug(`🔄 [Radar Alpha] Carregando histórico para ${tickers.length} ativos...`);
            const allHistories = await AssetHistory.find(
                { ticker: { $in: tickers } },
                { ticker: 1, history: { $slice: -60 } }
            ).lean();
            const historyMap = buildHistoryMap(allHistories);

            // 3. CARREGAR TODOS OS SINAIS ATIVOS (sem filtro de data — UPSERT mantém frescor)
            const activeSignals = await QuantSignal.find({ status: 'ACTIVE' })
                .select('ticker type _id').lean();

            // 4. LOOP DE ANÁLISE
            for (const asset of assets) {
                scanAsset(this, asset, historyMap, macroContext, scan);
            }

            // 5–7. PERSISTÊNCIA, AUTO-INVALIDAÇÃO E METADADOS DO SCAN
            return await persistScan(assets, activeSignals, scan, startTime);

        } catch (error) {
            logger.error(`❌ [Radar Alpha] Erro: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    // --- MOTOR DE AUDITORIA (EARLY EXIT / TAKE PROFIT) ---
    async runBacktest() {
        logger.info("🕵️ [Backtest] Iniciando Auditoria Dinâmica...");

        try {
            const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            const horizonDays = config?.backtestHorizon || 14;

            const activeSignals = await QuantSignal.find({ status: 'ACTIVE' });

            if (activeSignals.length === 0) {
                return { processed: 0 };
            }

            const tickers = [...new Set(activeSignals.map(s => s.ticker))];
            const assets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker lastPrice');
            const priceMap = new Map(assets.map(a => [a.ticker, a.lastPrice]));

            const { updates, tally } = auditSignals(activeSignals, priceMap, horizonDays);

            if (updates.length > 0) {
                await QuantSignal.bulkWrite(updates);
            }

            logger.info(`✅ [Backtest] ${tally.processed} sinais encerrados. (Hits: ${tally.hits} | Stops: ${tally.misses} | Expirados: ${tally.expired})`);
            return { processed: tally.processed, hits: tally.hits, misses: tally.misses };

        } catch (error) {
            logger.error(`❌ [Backtest] Erro: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
};
