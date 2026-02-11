
import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import QuantSignal from '../../models/QuantSignal.js';
import SystemConfig from '../../models/SystemConfig.js'; 
import { marketDataService } from '../marketDataService.js';
import { externalMarketService } from '../externalMarketService.js';

// Setores Defensivos para alinhar com Research
const DEFENSIVE_SECTORS = ['Saneamento', 'Elétricas', 'Seguros', 'Bancos', 'Telecom'];

export const signalEngine = {
    
    // --- FUNÇÕES MATEMÁTICAS PURAS ---

    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return null;
        
        let closes = prices.slice(0, period + 1); 
        
        let gains = 0;
        let losses = 0;

        for (let i = 0; i < period; i++) {
            const change = closes[i] - closes[i+1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }

        if (losses === 0) return 100;
        
        const rs = gains / losses;
        return 100 - (100 / (1 + rs));
    },

    determineRiskProfile(asset) {
        if (asset.type === 'FII') return 'MODERATE';
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
            // Busca Petróleo Brent (BZ=F) e Ibovespa (^BVSP) em tempo real
            const quotes = await externalMarketService.getQuotes(['BZ=F', '^BVSP']);
            const oil = quotes.find(q => q.ticker === 'BZ=F');
            const ibov = quotes.find(q => q.ticker === '^BVSP');

            return {
                oilChange: oil ? oil.change : 0,
                ibovChange: ibov ? ibov.change : 0,
                isCrashDay: ibov ? ibov.change < -2.5 : false
            };
        } catch (e) {
            logger.warn("⚠️ [SignalEngine] Falha ao obter contexto macro. Assumindo neutro.");
            return { oilChange: 0, ibovChange: 0, isCrashDay: false };
        }
    },

    isValidCorrelation(ticker, signalType, macroContext) {
        // Regra 1: Circuit Breaker de Pânico
        // Se o mercado está derretendo (>2.5% queda), evitamos compras agressivas, exceto Ouro/Dólar
        if (macroContext.isCrashDay && signalType !== 'RSI_OVERSOLD') {
            return { valid: false, reason: "Mercado em Pânico (IBOV < -2.5%)" };
        }

        // Regra 2: Correlação Petróleo (Petrobras, Prio, 3R)
        const oilTickers = ['PETR4', 'PETR3', 'PRIO3', 'RRRP3', 'RECV3', 'ENAT3'];
        if (oilTickers.includes(ticker)) {
            // Se Petróleo cai forte (>1.5%) e temos sinal de compra, vetamos.
            if (macroContext.oilChange < -1.5) {
                return { valid: false, reason: `Petróleo em queda livre (${macroContext.oilChange.toFixed(2)}%)` };
            }
        }

        // Regra 3: Correlação Vale/Minério (Simplificada via IBOV proxy ou futuro se tivesse)
        // Se IBOV cai forte, Vale tende a cair. (Pode ser refinado futuramente)
        if (ticker.startsWith('VALE') && macroContext.ibovChange < -2.0) {
             return { valid: false, reason: "Tendência macro negativa forte" };
        }

        return { valid: true };
    },

    // --- SCANNER PRINCIPAL ---

    async runScanner() {
        logger.info("📡 [Radar Alpha] Iniciando varredura quantitativa (v3.1 - Correlation Aware)...");
        const startTime = Date.now();
        
        // 0. Obter Contexto Macro para Correlações
        const macroContext = await this.getMacroContext();
        if (macroContext.oilChange !== 0) {
            logger.info(`🌍 [Macro Context] Petróleo: ${macroContext.oilChange.toFixed(2)}% | IBOV: ${macroContext.ibovChange.toFixed(2)}%`);
        }

        let signalsFound = 0;
        let signalsEvolved = 0;
        let assetsIgnored = 0;
        let correlationBlocks = 0;

        const newSignalsPayload = [];
        const updateOperations = [];

        try {
            // 1. CARREGAR ATIVOS
            const assets = await MarketAsset.find({ 
                isActive: true, 
                liquidity: { $gt: 500000 }, 
                isIgnored: false,
                isBlacklisted: false,
                type: { $in: ['STOCK', 'FII'] }
            }).lean(); 

            if (assets.length === 0) {
                logger.warn("⛔ [Radar Alpha] Nenhum ativo elegível.");
                return { success: true, signals: 0, analyzed: 0, ignored: 0 };
            }

            const tickers = assets.map(a => a.ticker);
            const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000); 

            // 2. PRE-FETCHING
            logger.info(`🔄 [Radar Alpha] Carregando histórico para ${tickers.length} ativos...`);
            const allHistories = await AssetHistory.find({ ticker: { $in: tickers } }).select('ticker history').lean();

            const historyMap = new Map();
            allHistories.forEach(h => {
                if(h.history && h.history.length > 50) {
                    historyMap.set(h.ticker, h.history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
                }
            });

            const activeSignals = await QuantSignal.find({
                status: 'ACTIVE', 
                timestamp: { $gte: cutoffDate }
            }).select('ticker type quality _id').lean();

            const signalCache = new Map();
            activeSignals.forEach(s => signalCache.set(`${s.ticker}-${s.type}`, { id: s._id, quality: s.quality }));

            // 3. PROCESSAMENTO
            for (const asset of assets) {
                try {
                    const history = historyMap.get(asset.ticker);
                    if (!history) continue; 

                    const closes = history.map(h => h.adjClose || h.close);
                    const currentPrice = asset.lastPrice;
                    const riskProfile = this.determineRiskProfile(asset);

                    // --- CHECK 1: RSI OVERSOLD ---
                    if (asset.netMargin > -5) {
                        const cacheKey = `${asset.ticker}-RSI_OVERSOLD`;
                        const existing = signalCache.get(cacheKey);
                        
                        if (!existing || existing.quality === 'SILVER') {
                            const rsi = this.calculateRSI(closes, 14);
                            
                            if (rsi !== null && rsi < 37) {
                                // VERIFICAÇÃO DE CORRELAÇÃO
                                const correlationCheck = this.isValidCorrelation(asset.ticker, 'RSI_OVERSOLD', macroContext);
                                if (!correlationCheck.valid) {
                                    correlationBlocks++;
                                    continue; // Pula este ativo
                                }

                                const isGold = rsi < 30;
                                const quality = isGold ? 'GOLD' : 'SILVER';
                                const message = `${isGold ? 'Sobrevenda Extrema' : 'Sobrevenda'}: RSI em ${rsi.toFixed(0)}. ${isGold ? 'Oportunidade Ouro.' : 'Monitorar repique.'}`;

                                if (existing && existing.quality === 'SILVER' && isGold) {
                                    updateOperations.push({
                                        updateOne: {
                                            filter: { _id: existing.id },
                                            update: { 
                                                $set: { 
                                                    quality: 'GOLD',
                                                    value: rsi,
                                                    message: `[UPGRADE] ${message}`, 
                                                    priceAtSignal: currentPrice, 
                                                    timestamp: new Date() 
                                                }
                                            }
                                        }
                                    });
                                    signalsEvolved++;
                                } else if (!existing) {
                                    newSignalsPayload.push({
                                        ticker: asset.ticker,
                                        assetType: asset.type,
                                        riskProfile: riskProfile,
                                        sector: asset.sector || 'Outros',
                                        type: 'RSI_OVERSOLD',
                                        quality: quality,
                                        value: rsi,
                                        message: message,
                                        priceAtSignal: currentPrice
                                    });
                                    signalsFound++;
                                } else {
                                    assetsIgnored++;
                                }
                            }
                        } else {
                            assetsIgnored++;
                        }
                    }

                    // --- CHECK 2: DEEP VALUE (Graham) ---
                    if (asset.pl > 0 && asset.p_vp > 0 && asset.type === 'STOCK') {
                        const cacheKey = `${asset.ticker}-DEEP_VALUE`;
                        const existing = signalCache.get(cacheKey);

                        if (!existing || existing.quality === 'SILVER') {
                            const grahamNumber = Math.sqrt(22.5 * (currentPrice / asset.pl) * (currentPrice / asset.p_vp)); 
                            const discount = currentPrice / grahamNumber;
                            
                            if (grahamNumber > 0 && discount < 0.80) {
                                
                                // Correlação para Value Investing é menos crítica, mas evitamos compra em dia de crash total
                                if (macroContext.isCrashDay && discount > 0.70) {
                                    correlationBlocks++;
                                    continue;
                                }

                                const isGold = discount < 0.70;
                                const quality = isGold ? 'GOLD' : 'SILVER';
                                const message = `Deep Value: Negociando a ${(discount*100).toFixed(0)}% do Valor Intrínseco.`;

                                if (existing && existing.quality === 'SILVER' && isGold) {
                                    updateOperations.push({
                                        updateOne: {
                                            filter: { _id: existing.id },
                                            update: { 
                                                $set: { quality: 'GOLD', value: grahamNumber, message: `[UPGRADE] ${message}`, priceAtSignal: currentPrice, timestamp: new Date() }
                                            }
                                        }
                                    });
                                    signalsEvolved++;
                                } else if (!existing) {
                                    newSignalsPayload.push({
                                        ticker: asset.ticker,
                                        assetType: asset.type,
                                        riskProfile: 'DEFENSIVE', 
                                        sector: asset.sector || 'Outros',
                                        type: 'DEEP_VALUE',
                                        quality: quality,
                                        value: grahamNumber,
                                        message: message,
                                        priceAtSignal: currentPrice
                                    });
                                    signalsFound++;
                                } else {
                                    assetsIgnored++;
                                }
                            }
                        } else {
                            assetsIgnored++;
                        }
                    }

                } catch (innerErr) { continue; }
            }

            // 4. PERSISTÊNCIA
            if (newSignalsPayload.length > 0) {
                await QuantSignal.insertMany(newSignalsPayload);
            }
            if (updateOperations.length > 0) {
                await QuantSignal.bulkWrite(updateOperations);
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`✅ [Radar Alpha] Concluído em ${duration}s. Novos: ${signalsFound} | Evoluídos: ${signalsEvolved} | Bloqueados (Macro): ${correlationBlocks}`);
            
            // CORREÇÃO: Retorna analyzed e ignored para o log do syncProdData.js
            return { 
                success: true, 
                signals: signalsFound, 
                evolved: signalsEvolved, 
                blocked: correlationBlocks,
                analyzed: assets.length,
                ignored: assetsIgnored
            };

        } catch (error) {
            logger.error(`❌ [Radar Alpha] Erro: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    // --- MOTOR DE AUDITORIA (EARLY EXIT / TAKE PROFIT) ---
    async runBacktest() {
        logger.info("🕵️ [Backtest] Iniciando Auditoria Dinâmica (Early Exit)...");
        
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
                }
                else if (signalAgeDays >= horizonDays) {
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
