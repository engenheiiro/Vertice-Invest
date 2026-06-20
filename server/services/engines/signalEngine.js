
import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import QuantSignal from '../../models/QuantSignal.js';
import SystemConfig from '../../models/SystemConfig.js';
import { marketDataService } from '../marketDataService.js';
import { externalMarketService } from '../externalMarketService.js';

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
            const ibov = quotes.find(q => q.ticker === 'BVSP');
            const spx = quotes.find(q => q.ticker === 'GSPC');

            return {
                oilChange: oil ? oil.change : 0,
                ibovChange: ibov ? ibov.change : 0,
                spxChange: spx ? spx.change : 0,
                isCrashDay: ibov ? ibov.change < -2.5 : false,
                isUSCrashDay: spx ? spx.change < -2.5 : false
            };
        } catch (e) {
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
        const wing = opts.wing ?? 2;                 // pregões de cada lado p/ confirmar o pivô
        const minSeparation = opts.minSeparation ?? 3; // distância mínima entre os dois fundos
        const maxLookback = opts.maxLookback ?? 40;  // janela de busca de pivôs
        const rsiZone = opts.rsiZone ?? 45;          // fundo recente precisa estar em zona fraca
        const maxRecentAge = opts.maxRecentAge ?? 6; // frescor: pivô recente precisa estar perto de hoje

        if (!Array.isArray(closes)) return null;
        const minLen = period + wing + minSeparation + 2;
        if (closes.length < minLen) return null;

        const rsi = this._rsiSeries(closes, period);

        // Coleta pivôs de baixa (mínimos locais) dentro da janela de lookback.
        const pivots = [];
        const limit = Math.min(closes.length - wing, maxLookback);
        for (let i = wing; i < limit; i++) {
            if (rsi[i] == null) continue;
            let isLow = true;
            for (let k = 1; k <= wing; k++) {
                if (!(closes[i] < closes[i - k]) || !(closes[i] < closes[i + k])) { isLow = false; break; }
            }
            if (isLow) pivots.push(i);
        }

        if (pivots.length < 2) return null;

        const recent = pivots[0];               // menor índice = pivô mais recente
        if (recent > maxRecentAge) return null;       // pivô recente precisa ser fresco
        if (!(closes[0] > closes[recent])) return null; // preço já reagindo acima do fundo

        let older = null;
        for (let j = 1; j < pivots.length; j++) {
            if (pivots[j] - recent >= minSeparation) { older = pivots[j]; break; }
        }
        if (older === null) return null;

        const priceLowerLow = closes[recent] < closes[older];
        const rsiHigherLow = rsi[recent] > rsi[older];

        if (priceLowerLow && rsiHigherLow && rsi[recent] < rsiZone) {
            return {
                rsiAtLow: rsi[recent],
                priorRsiLow: rsi[older],
                priceLow: closes[recent],
                priorPriceLow: closes[older],
                barsBetween: older - recent,
            };
        }
        return null;
    },

    // --- SCANNER PRINCIPAL ---

    async runScanner() {
        logger.info("📡 [Radar Alpha] Iniciando varredura (v4.0 - UPSERT + Auto-Invalidação)...");
        const startTime = Date.now();

        const macroContext = await this.getMacroContext();
        if (macroContext.oilChange !== 0) {
            logger.debug(`🌍 [Macro] Petróleo: ${macroContext.oilChange.toFixed(2)}% | IBOV: ${macroContext.ibovChange.toFixed(2)}%`);
        }

        // Pares (ticker-type) que AINDA atendem condições nesta varredura
        const processedPairs = new Set();
        // Tickers que tiveram histórico disponível e foram efetivamente analisados
        const scannedTickers = new Set();
        // Operações de upsert para o bulkWrite
        const upsertOps = [];
        let correlationBlocks = 0;

        try {
            // 1. CARREGAR ATIVOS
            const assets = await MarketAsset.find({
                isActive: true,
                isIgnored: false,
                isBlacklisted: false,
                type: { $in: ['STOCK', 'FII', 'STOCK_US'] },
                $or: [
                    { liquidity: { $gt: 500000 } },
                    { avgLiquidity: { $gt: 500000 } }
                ]
            }).lean();

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

            const historyMap = new Map();
            allHistories.forEach(h => {
                if (h.history && h.history.length > 15) {
                    historyMap.set(h.ticker, h.history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
                }
            });

            // 3. CARREGAR TODOS OS SINAIS ATIVOS (sem filtro de data — UPSERT mantém frescor)
            const activeSignals = await QuantSignal.find({ status: 'ACTIVE' })
                .select('ticker type _id').lean();

            // 4. LOOP DE ANÁLISE
            for (const asset of assets) {
                try {
                    const history = historyMap.get(asset.ticker);
                    if (!history) continue;

                    scannedTickers.add(asset.ticker);

                    const closes = history.map(h => h.adjClose || h.close).filter(v => v > 0);
                    const currentPrice = asset.lastPrice;
                    const riskProfile = this.determineRiskProfile(asset);

                    // Confirmação de volume (7.3): volume atual >= 1.2x média dos
                    // últimos 20 pregões. Degrada com segurança se não houver dado.
                    const volume = this._volumeStats(history);
                    const hasVolumeConfirmation = volume.confirmed;
                    const volumeRatio = volume.ratio;

                    // --- CHECK 1: RSI OVERSOLD (GOLD only: RSI < 30 + reversão + volume) ---
                    if (asset.netMargin > -5) {
                        const rsi = this.calculateRSI(closes, 14);
                        // Exige que o preço de hoje esteja acima de ontem (rebate confirmado, não faca caindo)
                        const isReverting = closes.length >= 3 && closes[0] > closes[1];

                        if (rsi !== null && rsi < 30 && isReverting && hasVolumeConfirmation) {
                            // Filtro de tendência: bloqueia downtrends moderados (preço > 15% abaixo da SMA200)
                            const trendBlock = asset.sma200 > 0 && currentPrice < asset.sma200 * 0.85;

                            if (trendBlock) {
                                correlationBlocks++;
                            } else {
                                const correlationCheck = this.isValidCorrelation(asset.ticker, 'RSI_OVERSOLD', macroContext, asset.type);

                                if (!correlationCheck.valid) {
                                    correlationBlocks++;
                                } else {
                                    const quality = 'GOLD';
                                    const urgencyLevel = this._rsiUrgency(rsi);
                                    const message = `${rsi < 20 ? 'Sobrevenda Extrema' : 'Sobrevenda Técnica'}: RSI em ${rsi.toFixed(0)}. Anomalia estatística detectada.`;

                                    processedPairs.add(`${asset.ticker}-RSI_OVERSOLD`);
                                    upsertOps.push({
                                        updateOne: {
                                            filter: { ticker: asset.ticker, type: 'RSI_OVERSOLD', status: 'ACTIVE' },
                                            update: {
                                                $set: { quality, value: rsi, message, urgencyLevel, volumeRatio, timestamp: new Date() },
                                                $setOnInsert: {
                                                    ticker: asset.ticker,
                                                    type: 'RSI_OVERSOLD',
                                                    assetType: asset.type,
                                                    riskProfile,
                                                    sector: asset.sector || 'Outros',
                                                    priceAtSignal: currentPrice,
                                                    status: 'ACTIVE'
                                                }
                                            },
                                            upsert: true
                                        }
                                    });
                                }
                            }
                        }
                    }

                    // --- CHECK 3: DIVERGÊNCIA ALTISTA (preço faz fundo mais baixo, RSI faz fundo mais alto) ---
                    // Filtra por mesma trava de qualidade do RSI: margem saudável, volume
                    // confirmando e sem downtrend severo. Sinal de virada antecipada.
                    if (asset.netMargin > -5 && hasVolumeConfirmation) {
                        const divergence = this.detectBullishDivergence(closes, 14);
                        const trendBlock = asset.sma200 > 0 && currentPrice < asset.sma200 * 0.85;

                        if (divergence && !trendBlock) {
                            const correlationCheck = this.isValidCorrelation(asset.ticker, 'RSI_OVERSOLD', macroContext, asset.type);

                            if (!correlationCheck.valid) {
                                correlationBlocks++;
                            } else {
                                const quality = 'GOLD';
                                const urgencyLevel = this._divergenceUrgency(divergence.rsiAtLow);
                                const message = `Divergência Altista: preço em novo fundo, mas RSI subindo (${divergence.rsiAtLow.toFixed(0)} vs ${divergence.priorRsiLow.toFixed(0)}). Possível virada.`;

                                processedPairs.add(`${asset.ticker}-BULLISH_DIVERGENCE`);
                                upsertOps.push({
                                    updateOne: {
                                        filter: { ticker: asset.ticker, type: 'BULLISH_DIVERGENCE', status: 'ACTIVE' },
                                        update: {
                                            $set: { quality, value: divergence.rsiAtLow, message, urgencyLevel, volumeRatio, timestamp: new Date() },
                                            $setOnInsert: {
                                                ticker: asset.ticker,
                                                type: 'BULLISH_DIVERGENCE',
                                                assetType: asset.type,
                                                riskProfile,
                                                sector: asset.sector || 'Outros',
                                                priceAtSignal: currentPrice,
                                                status: 'ACTIVE'
                                            }
                                        },
                                        upsert: true
                                    }
                                });
                            }
                        }
                    }

                    // --- CHECK 2: DEEP VALUE Graham (GOLD only: desconto < 70% + ROE > 0 + sem downtrend) ---
                    const inDowntrend = asset.sma200 > 0 && currentPrice < asset.sma200;
                    if (asset.pl > 0 && asset.p_vp > 0 && asset.type === 'STOCK' && asset.roe > 0 && !inDowntrend) {
                        const grahamNumber = Math.sqrt(22.5 * (currentPrice / asset.pl) * (currentPrice / asset.p_vp));
                        const discount = currentPrice / grahamNumber;

                        if (grahamNumber > 0 && discount < 0.70) {
                            const quality = 'GOLD';
                            const urgencyLevel = this._grahamUrgency(discount);
                            const message = `Deep Value: Negociando a ${(discount * 100).toFixed(0)}% do Valor Intrínseco. ROE: ${asset.roe?.toFixed(1)}%.`;

                            processedPairs.add(`${asset.ticker}-DEEP_VALUE`);
                            upsertOps.push({
                                updateOne: {
                                    filter: { ticker: asset.ticker, type: 'DEEP_VALUE', status: 'ACTIVE' },
                                    update: {
                                        $set: { quality, value: grahamNumber, message, urgencyLevel, timestamp: new Date() },
                                        $setOnInsert: {
                                            ticker: asset.ticker,
                                            type: 'DEEP_VALUE',
                                            assetType: asset.type,
                                            riskProfile: 'DEFENSIVE',
                                            sector: asset.sector || 'Outros',
                                            priceAtSignal: currentPrice,
                                            status: 'ACTIVE'
                                        }
                                    },
                                    upsert: true
                                }
                            });
                        }
                    }

                } catch (innerErr) { continue; }
            }

            // 5. PERSISTÊNCIA — UPSERT atômico (sem acúmulo: máximo 1 ACTIVE por ticker/tipo)
            if (upsertOps.length > 0) {
                await QuantSignal.bulkWrite(upsertOps, { ordered: false });
            }

            // 6. AUTO-INVALIDAÇÃO — fecha sinais cujas condições não são mais válidas
            // Apenas para tickers que foram efetivamente analisados nesta varredura
            const scannedTickersArr = [...scannedTickers];
            const staleSignals = activeSignals.filter(
                s => scannedTickersArr.includes(s.ticker) && !processedPairs.has(`${s.ticker}-${s.type}`)
            );

            let staleCount = 0;
            if (staleSignals.length > 0) {
                await QuantSignal.updateMany(
                    { _id: { $in: staleSignals.map(s => s._id) } },
                    { $set: { status: 'NEUTRAL', auditDate: new Date(), message: 'Condição revertida durante varredura.' } }
                );
                staleCount = staleSignals.length;
            }

            // 7. METADATA DO SCAN — salva no SystemConfig para o frontend
            const totalActiveAfter = await QuantSignal.countDocuments({ status: 'ACTIVE' });
            await SystemConfig.findOneAndUpdate(
                { key: 'RADAR_SCAN_META' },
                {
                    $set: {
                        value: {
                            lastScanAt: new Date(),
                            assetsScanned: assets.length,
                            assetsWithHistory: scannedTickers.size,
                            upsertedSignals: upsertOps.length,
                            staleSignalsClosed: staleCount,
                            activeSignalsTotal: totalActiveAfter
                        }
                    }
                },
                { upsert: true }
            );

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`✅ [Radar Alpha] ${duration}s. Upserts: ${upsertOps.length} | Inativados: ${staleCount} | Ativos: ${totalActiveAfter} | Bloqueados: ${correlationBlocks}`);

            return {
                success: true,
                signals: upsertOps.length,
                staleInactivated: staleCount,
                blocked: correlationBlocks,
                analyzed: assets.length,
                ignored: 0
            };

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

            const TAKE_PROFIT_PCT = 3.5;
            const STOP_LOSS_PCT = -3.5;

            const activeSignals = await QuantSignal.find({ status: 'ACTIVE' });

            if (activeSignals.length === 0) {
                return { processed: 0 };
            }

            const tickers = [...new Set(activeSignals.map(s => s.ticker))];
            const assets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker lastPrice');
            const priceMap = new Map(assets.map(a => [a.ticker, a.lastPrice]));

            let processed = 0;
            let hits = 0;
            let misses = 0;
            let expired = 0;
            const updates = [];
            const now = new Date();

            for (const signal of activeSignals) {
                const currentPrice = priceMap.get(signal.ticker);

                if (!currentPrice || currentPrice <= 0 || !signal.priceAtSignal) continue;

                const resultPercent = ((currentPrice - signal.priceAtSignal) / signal.priceAtSignal) * 100;
                const signalAgeDays = (now.getTime() - new Date(signal.timestamp).getTime()) / (1000 * 3600 * 24);

                let newStatus = null;

                if (resultPercent >= TAKE_PROFIT_PCT) {
                    newStatus = 'HIT';
                } else if (resultPercent <= STOP_LOSS_PCT) {
                    newStatus = 'MISS';
                } else if (signalAgeDays >= horizonDays) {
                    newStatus = 'NEUTRAL';
                }

                if (newStatus) {
                    updates.push({
                        updateOne: {
                            filter: { _id: signal._id },
                            update: {
                                $set: {
                                    status: newStatus,
                                    finalPrice: currentPrice,
                                    resultPercent: resultPercent,
                                    auditDate: new Date()
                                }
                            }
                        }
                    });

                    processed++;
                    if (newStatus === 'HIT') hits++;
                    if (newStatus === 'MISS') misses++;
                    if (newStatus === 'NEUTRAL') expired++;
                }
            }

            if (updates.length > 0) {
                await QuantSignal.bulkWrite(updates);
            }

            logger.info(`✅ [Backtest] ${processed} sinais encerrados. (Hits: ${hits} | Stops: ${misses} | Expirados: ${expired})`);
            return { processed, hits, misses };

        } catch (error) {
            logger.error(`❌ [Backtest] Erro: ${error.message}`);
            return { error: error.message };
        }
    }
};
