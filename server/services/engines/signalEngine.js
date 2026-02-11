
import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import QuantSignal from '../../models/QuantSignal.js';
import SystemConfig from '../../models/SystemConfig.js'; // Importado
import { marketDataService } from '../marketDataService.js';

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

    // --- SCANNER PRINCIPAL ---

    async runScanner() {
        logger.info("📡 [Radar Alpha] Iniciando varredura quantitativa (v2.4)...");
        const startTime = Date.now();
        
        // Métricas de Telemetria
        let signalsFound = 0;
        let assetsAnalyzed = 0;
        let assetsIgnored = 0;

        try {
            // 0. HEALTH CHECK DE LIQUIDEZ (SRE)
            // Previne execução em base vazia ou corrompida
            const validLiquidityCount = await MarketAsset.countDocuments({ liquidity: { $gt: 500000 } });
            
            if (validLiquidityCount === 0) {
                const msg = "⛔ [Radar Alpha] ABORTADO: Base de dados parece vazia ou sem liquidez. Verifique o Sync de Preços.";
                logger.error(msg);
                return { success: false, error: msg, signals: 0, analyzed: 0, ignored: 0 };
            }

            // 1. Carrega ativos
            const assets = await MarketAsset.find({ 
                isActive: true, 
                liquidity: { $gt: 500000 }, 
                isIgnored: false,
                isBlacklisted: false,
                type: { $in: ['STOCK', 'FII'] }
            });

            const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h atrás

            for (const asset of assets) {
                assetsAnalyzed++;
                try {
                    // Evita spam de sinais (Deduplicação)
                    const exists = await QuantSignal.findOne({
                        ticker: asset.ticker,
                        type: { $in: ['RSI_OVERSOLD', 'DEEP_VALUE', 'SUPPORT_ZONE'] },
                        timestamp: { $gte: cutoffDate }
                    });
                    
                    if (exists) {
                        assetsIgnored++;
                        continue;
                    }

                    const historyDoc = await AssetHistory.findOne({ ticker: asset.ticker }).lean();
                    if (!historyDoc || !historyDoc.history || historyDoc.history.length < 50) continue;

                    const history = historyDoc.history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                    const closes = history.map(h => h.adjClose || h.close);
                    const currentPrice = asset.lastPrice;
                    
                    const riskProfile = this.determineRiskProfile(asset);

                    // --- CHECK 1: SNIPER DE SOBREVENDA (RSI 14 < 30) ---
                    if (asset.netMargin > -5) {
                        const rsi = this.calculateRSI(closes, 14);
                        if (rsi !== null && rsi < 30) {
                            await QuantSignal.create({
                                ticker: asset.ticker,
                                assetType: asset.type,
                                riskProfile: riskProfile,
                                sector: asset.sector || 'Outros', // Salva setor
                                type: 'RSI_OVERSOLD',
                                value: rsi,
                                message: `Sobrevenda Técnica: RSI em ${rsi.toFixed(0)}. Possível repique.`,
                                priceAtSignal: currentPrice
                            });
                            signalsFound++;
                        }
                    }

                    // --- CHECK 2: DEEP VALUE (Graham) ---
                    if (asset.pl > 0 && asset.p_vp > 0 && asset.type === 'STOCK') {
                        const grahamNumber = Math.sqrt(22.5 * (currentPrice / asset.pl) * (currentPrice / asset.p_vp)); 
                        if (grahamNumber > 0 && currentPrice < (grahamNumber * 0.7)) { 
                            await QuantSignal.create({
                                ticker: asset.ticker,
                                assetType: asset.type,
                                riskProfile: 'DEFENSIVE', 
                                sector: asset.sector || 'Outros',
                                type: 'DEEP_VALUE',
                                value: grahamNumber,
                                message: `Deep Value: Negociando a ~${((currentPrice/grahamNumber)*100).toFixed(0)}% do Valor Intrínseco de Graham.`,
                                priceAtSignal: currentPrice
                            });
                            signalsFound++;
                        }
                    }

                    // --- CHECK 3: SUPORTE ANUAL (52-Week Low) ---
                    if (history.length >= 250 && asset.netMargin > 0) {
                        const yearPrices = closes.slice(0, 250); 
                        const low52 = Math.min(...yearPrices);
                        const distToLow = (currentPrice / low52) - 1;

                        if (distToLow < 0.05 && asset.dy > 4) { 
                            await QuantSignal.create({
                                ticker: asset.ticker,
                                assetType: asset.type,
                                riskProfile: riskProfile,
                                sector: asset.sector || 'Outros',
                                type: 'SUPPORT_ZONE',
                                value: distToLow * 100,
                                message: `Zona de Suporte: Próximo à mínima de 52 sem. (${low52.toFixed(2)}) com Yield Sólido.`,
                                priceAtSignal: currentPrice
                            });
                            signalsFound++;
                        }
                    }

                } catch (innerErr) {
                    continue;
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`✅ [Radar Alpha] Varredura concluída em ${duration}s. ${signalsFound} novos sinais.`);
            
            return { 
                success: true, 
                signals: signalsFound,
                analyzed: assetsAnalyzed,
                ignored: assetsIgnored 
            };

        } catch (error) {
            logger.error(`❌ [Radar Alpha] Falha Crítica: ${error.message}`);
            return { success: false, error: error.message, signals: 0, analyzed: 0, ignored: 0 };
        }
    },

    // --- MOTOR DE AUDITORIA (BACKTEST DINÂMICO) ---
    async runBacktest() {
        logger.info("🕵️ [Radar Alpha] Iniciando Backtest Automático de Sinais...");
        
        try {
            // Busca Configuração do Admin
            const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            const horizonDays = config?.backtestHorizon || 7; // Padrão 7 dias se não configurado

            // Busca sinais ATIVOS criados há mais de X dias
            const horizonDate = new Date();
            horizonDate.setDate(horizonDate.getDate() - horizonDays);
            
            // Margem de segurança (Janela de processamento de 30 dias para trás do horizonte)
            const cutoffDate = new Date(horizonDate);
            cutoffDate.setDate(cutoffDate.getDate() - 30);

            const signalsToAudit = await QuantSignal.find({
                status: 'ACTIVE',
                timestamp: { $lte: horizonDate, $gte: cutoffDate }
            });

            if (signalsToAudit.length === 0) {
                logger.info(`✅ [Backtest] Nenhum sinal pendente de auditoria (Horizonte: ${horizonDays} dias).`);
                return { processed: 0 };
            }

            let processed = 0;
            let hits = 0;

            for (const signal of signalsToAudit) {
                const marketData = await marketDataService.getMarketDataByTicker(signal.ticker);
                const currentPrice = marketData.price;

                if (currentPrice > 0 && signal.priceAtSignal > 0) {
                    const resultPercent = ((currentPrice - signal.priceAtSignal) / signal.priceAtSignal) * 100;
                    
                    let status = 'NEUTRAL';
                    if (resultPercent >= 2.0) status = 'HIT'; 
                    else if (resultPercent <= -2.0) status = 'MISS'; 
                    else status = 'NEUTRAL';

                    signal.status = status;
                    signal.finalPrice = currentPrice;
                    signal.resultPercent = resultPercent;
                    signal.auditDate = new Date();
                    
                    await signal.save();
                    processed++;
                    if (status === 'HIT') hits++;
                }
            }

            logger.info(`✅ [Backtest] ${processed} sinais auditados (H: ${horizonDays}d). ${hits} Hits.`);
            return { processed };

        } catch (error) {
            logger.error(`❌ [Backtest] Erro: ${error.message}`);
            return { error: error.message };
        }
    }
};
