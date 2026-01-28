
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { externalMarketService } from './externalMarketService.js';

const FALLBACK_MACRO = {
    selic: { value: 11.25 },
    cdi: { value: 11.15 },
    ipca: { value: 4.50 },
    riskFree: { value: 11.25 },
    ntnbLong: { value: 6.30 },
    ibov: { value: 128000, change: 0 },
    usd: { value: 5.75, change: 0 },
    spx: { value: 5200, change: 0 },
    btc: { value: 65000, change: 0 }
};

export const marketDataService = {
    normalizeSymbol(ticker) {
        if (!ticker) return '';
        return ticker.toUpperCase().trim().replace('.SA', '');
    },

    async getMarketDataByTicker(ticker) {
        try {
            const cleanTicker = this.normalizeSymbol(ticker);
            const asset = await MarketAsset.findOne({ ticker: cleanTicker });

            if (asset) {
                return { 
                    price: asset.lastPrice || 0, 
                    change: 0, 
                    name: asset.name 
                };
            }
            return { price: 0, change: 0, name: ticker };
        } catch (error) {
            logger.error(`Erro ao ler ticker ${ticker}: ${error.message}`);
            return { price: 0, change: 0, name: ticker };
        }
    },

    async getMacroIndicators() {
        try {
            // Busca do banco (Fonte da Verdade)
            const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            
            // Busca índices de mercado ao vivo (Yahoo) para complementar (Ibov/SPX)
            const liveIndices = await externalMarketService.getGlobalIndices();

            if (config) {
                return {
                    selic: { value: config.selic },
                    cdi: { value: config.cdi },
                    ipca: { value: config.ipca },
                    riskFree: { value: config.riskFree },
                    ntnbLong: { value: config.ntnbLong },
                    usd: { value: config.dollar, change: 0 },
                    
                    // Mescla dados do banco com dados live do Yahoo
                    ibov: liveIndices.ibov || { value: 128000, change: 0 },
                    spx: liveIndices.spx || { value: 5200, change: 0 },
                    
                    // BTC geralmente vem do Yahoo/AwesomeAPI, mas podemos ter um fallback
                    btc: { value: 0, change: 0 } 
                };
            }
            return FALLBACK_MACRO;
        } catch (e) {
            logger.error(`Erro Macro: ${e.message}`);
            return FALLBACK_MACRO;
        }
    },

    async performFullSync() {
        try {
            logger.info("🔄 [SYNC] Iniciando sincronização TOTAL de dados...");
            
            // 1. Atualiza Macro (BCB, Tesouro, Moedas)
            // Isso garante que o valuation use taxas atualizadas
            await macroDataService.performMacroSync();

            const operations = [];
            const timestamp = new Date();

            // 2. Fundamentus (B3 - Ações e FIIs)
            const stocksMap = await fundamentusService.getStocksMap();
            const fiiMap = await fundamentusService.getFIIsMap();

            const pushOp = (ticker, data, type) => {
                operations.push({
                    updateOne: {
                        filter: { ticker: ticker },
                        update: {
                            $set: {
                                lastPrice: Number(data.price) || 0,
                                dy: Number(data.dy) || 0,
                                p_vp: Number(data.pvp) || 0,
                                marketCap: Number(data.marketCap) || 0,
                                vacancy: Number(data.vacancy) || 0,
                                sector: data.sector || undefined,
                                lastAnalysisDate: timestamp,
                                updatedAt: timestamp
                            },
                            $setOnInsert: {
                                name: ticker, type, currency: 'BRL',
                                isIgnored: false, isBlacklisted: false
                            }
                        },
                        upsert: true
                    }
                });
            };

            if (stocksMap) stocksMap.forEach((v, k) => pushOp(k, v, 'STOCK'));
            if (fiiMap) fiiMap.forEach((v, k) => pushOp(k, v, 'FII'));

            // 3. External (Crypto e Stocks US)
            // Busca todos os ativos desses tipos já cadastrados no banco para atualizar preço
            const externalAssets = await MarketAsset.find({ 
                type: { $in: ['CRYPTO', 'STOCK_US'] } 
            }).select('ticker type');

            if (externalAssets.length > 0) {
                const tickersToFetch = externalAssets.map(a => a.ticker);
                logger.info(`🌐 [SYNC] Buscando cotações externas para: ${tickersToFetch.join(', ')}`);
                
                const quotes = await externalMarketService.getQuotes(tickersToFetch);
                
                quotes.forEach(quote => {
                    operations.push({
                        updateOne: {
                            filter: { ticker: quote.ticker },
                            update: {
                                $set: {
                                    lastPrice: quote.price,
                                    updatedAt: timestamp
                                }
                            }
                        }
                    });
                });
            }

            // Executa BulkWrite
            if (operations.length > 0) {
                logger.info(`💾 [SYNC] Persistindo ${operations.length} atualizações no banco...`);
                await MarketAsset.bulkWrite(operations);
                logger.info("✅ [SYNC] Sincronização concluída com sucesso!");
                return { success: true, count: operations.length };
            } else {
                return { success: false, count: 0 };
            }

        } catch (error) {
            logger.error(`❌ [SYNC] Falha fatal: ${error.message}`);
            throw error;
        }
    },

    // Mantido para compatibilidade com o ResearchController antigo
    async getMarketData(assetClass) {
        // ... (Mesma lógica anterior de getMarketData, mas pode ser otimizada para ler do banco)
        // Por brevidade e segurança, mantemos a lógica híbrida existente aqui, 
        // mas agora ela se beneficia do performFullSync rodando em background.
        
        // Reutilizar lógica existente do arquivo original para getMarketData...
        // (Vou reescrever a parte essencial para garantir que funcione com o novo structure)
        
        const isBrasil = assetClass === 'STOCK' || assetClass === 'FII' || assetClass === 'BRASIL_10';
        const results = [];
        
        if (isBrasil) {
            const allDbAssets = await MarketAsset.find({ 
                $or: [{ type: 'STOCK' }, { type: 'FII' }] 
            }).select('ticker sector isIgnored isBlacklisted isTier1');
            
            const dbAssetMap = new Map();
            allDbAssets.forEach(a => dbAssetMap.set(a.ticker, a));

            let fundDataMap = new Map();

            if (assetClass === 'STOCK' || assetClass === 'BRASIL_10') {
                const stockMap = await fundamentusService.getStocksMap();
                if (stockMap) stockMap.forEach((v, k) => fundDataMap.set(k, { ...v, type: 'STOCK' }));
            }
            if (assetClass === 'FII' || assetClass === 'BRASIL_10') {
                const fiiMap = await fundamentusService.getFIIsMap();
                if (fiiMap) fiiMap.forEach((v, k) => fundDataMap.set(k, { ...v, type: 'FII' }));
            }

            for (const [ticker, fundData] of fundDataMap) {
                const dbInfo = dbAssetMap.get(ticker);
                if (dbInfo && dbInfo.isIgnored) continue;
                
                const liquidity = fundData.liq2m || fundData.liquidity || 0;
                if (liquidity < 200000) continue; 

                let sector = fundData.sector;
                if (dbInfo && dbInfo.sector && dbInfo.sector !== 'Geral' && dbInfo.sector !== 'Outros') {
                    sector = dbInfo.sector;
                }
                if (!sector) sector = 'Geral';

                results.push({
                    ticker: ticker,
                    type: fundData.type,
                    name: ticker, 
                    sector: sector,
                    price: fundData.price,
                    dbFlags: { isBlacklisted: dbInfo?.isBlacklisted, isTier1: dbInfo?.isTier1 }, 
                    metrics: {
                        ...fundData,
                        marketCap: fundData.marketCap || 0,
                        avgLiquidity: liquidity,
                        roe: fundData.roe || 0,
                        dy: fundData.dy || 0,
                        pvp: fundData.pvp || 0,
                        pl: fundData.pl || 0
                    }
                });
            }
        }
        
        if (assetClass === 'STOCK' || assetClass === 'BRASIL_10') {
            return deduplicateAssets(results);
        }
        return results;
    }
};

const deduplicateAssets = (assets) => {
    const grouped = {};
    assets.forEach(asset => {
        let root = asset.ticker.substring(0, 4);
        if (!grouped[root]) {
            grouped[root] = asset;
        } else {
            if (asset.metrics.avgLiquidity > grouped[root].metrics.avgLiquidity) {
                grouped[root] = asset;
            }
        }
    });
    return Object.values(grouped);
};
