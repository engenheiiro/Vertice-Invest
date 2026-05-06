
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
    _grahamUrgency(discount) {
        if (discount < 0.60) return 'CRITICAL';
        if (discount < 0.70) return 'HIGH';
        return 'MEDIUM';
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

                    // --- CHECK 1: RSI OVERSOLD ---
                    if (asset.netMargin > -5) {
                        const rsi = this.calculateRSI(closes, 14);

                        if (rsi !== null && rsi < 37) {
                            const correlationCheck = this.isValidCorrelation(asset.ticker, 'RSI_OVERSOLD', macroContext, asset.type);

                            if (!correlationCheck.valid) {
                                correlationBlocks++;
                            } else {
                                const isGold = rsi < 30;
                                const quality = isGold ? 'GOLD' : 'SILVER';
                                const urgencyLevel = this._rsiUrgency(rsi);
                                const message = `${isGold ? 'Sobrevenda Extrema' : 'Sobrevenda'}: RSI em ${rsi.toFixed(0)}. ${isGold ? 'Oportunidade Ouro.' : 'Monitorar repique.'}`;

                                processedPairs.add(`${asset.ticker}-RSI_OVERSOLD`);
                                upsertOps.push({
                                    updateOne: {
                                        filter: { ticker: asset.ticker, type: 'RSI_OVERSOLD', status: 'ACTIVE' },
                                        update: {
                                            // Atualiza campos dinâmicos a cada varredura
                                            $set: { quality, value: rsi, message, urgencyLevel, timestamp: new Date() },
                                            // Campos imutáveis: só definidos na criação
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

                    // --- CHECK 2: DEEP VALUE (Graham) ---
                    if (asset.pl > 0 && asset.p_vp > 0 && asset.type === 'STOCK') {
                        const grahamNumber = Math.sqrt(22.5 * (currentPrice / asset.pl) * (currentPrice / asset.p_vp));
                        const discount = currentPrice / grahamNumber;

                        if (grahamNumber > 0 && discount < 0.80) {
                            if (macroContext.isCrashDay && discount > 0.70) {
                                correlationBlocks++;
                            } else {
                                const isGold = discount < 0.70;
                                const quality = isGold ? 'GOLD' : 'SILVER';
                                const urgencyLevel = this._grahamUrgency(discount);
                                const message = `Deep Value: Negociando a ${(discount * 100).toFixed(0)}% do Valor Intrínseco.`;

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
            const horizonDays = config?.backtestHorizon || 7;

            const TAKE_PROFIT_PCT = 3.0;
            const STOP_LOSS_PCT = -2.0;

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
