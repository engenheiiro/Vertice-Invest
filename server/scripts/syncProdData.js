
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { marketDataService } from '../services/marketDataService.js';
import { aiResearchService } from '../services/aiResearchService.js';
import MarketAnalysis from '../models/MarketAnalysis.js';

// Configuração de ambiente para rodar via terminal
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tenta carregar .env da raiz do projeto (onde geralmente fica em dev)
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const maskUri = (uri) => {
    if (!uri) return 'UNDEFINED';
    if (uri.includes('localhost') || uri.includes('127.0.0.1')) return 'LOCALHOST (Ambiente de Teste)';
    return 'ATLAS CLOUD (Produção/Remoto) ☁️';
};

const getDiverseCandidates = (list, count, maxPerSector = 2) => {
    const selected = [];
    const sectorCounts = {};
    const usedTickers = new Set();

    const sortedList = list.sort((a, b) => {
        const profileScore = { 'DEFENSIVE': 3, 'MODERATE': 2, 'BOLD': 1 };
        const pA = profileScore[a.riskProfile] || 0;
        const pB = profileScore[b.riskProfile] || 0;
        if (pA !== pB) return pB - pA;
        if (b.score !== a.score) return b.score - a.score;
        return (b.metrics?.avgLiquidity || 0) - (a.metrics?.avgLiquidity || 0);
    });

    for (const asset of sortedList) {
        if (selected.length >= count) break;
        if (usedTickers.has(asset.ticker)) continue;
        const sector = asset.sector || 'Outros';
        const currentCount = sectorCounts[sector] || 0;
        if (currentCount < maxPerSector) {
            selected.push(asset);
            sectorCounts[sector] = currentCount + 1;
            usedTickers.add(asset.ticker);
        }
    }
    return selected;
};

const runProtocolV3 = async () => {
    console.log("\n🚀 PROTOCOLO V3: Iniciando Análise Quantitativa Automática...");
    const strat = 'BUY_HOLD';
    
    // STOCK
    console.log("   ➤ Analisando Ações...");
    const stockData = await aiResearchService.calculateRanking('STOCK', strat);
    await MarketAnalysis.create({ assetClass: 'STOCK', strategy: strat, content: { ranking: stockData.ranking, fullAuditLog: stockData.fullList }, generatedBy: null });
    
    // FII
    console.log("   ➤ Analisando FIIs...");
    const fiiData = await aiResearchService.calculateRanking('FII', strat);
    await MarketAnalysis.create({ assetClass: 'FII', strategy: strat, content: { ranking: fiiData.ranking, fullAuditLog: fiiData.fullList }, generatedBy: null });

    // BRASIL 10
    console.log("   ➤ Gerando Brasil 10 (Smart Mix)...");
    const defStocks = stockData.fullList.filter(a => a.riskProfile === 'DEFENSIVE');
    const defFIIs = fiiData.fullList.filter(a => a.riskProfile === 'DEFENSIVE');
    
    const poolStocks = defStocks.length >= 5 ? defStocks : stockData.fullList;
    const poolFIIs = defFIIs.length >= 5 ? defFIIs : fiiData.fullList;

    const top5Stocks = getDiverseCandidates(poolStocks, 5, 2); 
    const top5FIIs = getDiverseCandidates(poolFIIs, 5, 2);
    
    let brasil10List = [...top5Stocks, ...top5FIIs]
        .sort((a, b) => b.score - a.score)
        .map((item, idx) => ({ ...item, position: idx + 1 })); 
    
    await MarketAnalysis.create({ assetClass: 'BRASIL_10', strategy: strat, content: { ranking: brasil10List, fullAuditLog: brasil10List }, generatedBy: null });
    
    console.log("✅ PROTOCOLO V3 CONCLUÍDO COM SUCESSO!");
};

const syncProd = async () => {
    try {
        console.log("\n==================================================");
        console.log("🚀 VÉRTICE INVEST - LOCAL WORKER SYNC & ANALYZE");
        console.log("==================================================");
        
        if (!process.env.MONGO_URI) {
            throw new Error("❌ MONGO_URI não definida no .env local.");
        }

        console.log(`🎯 ALVO: \x1b[36m${maskUri(process.env.MONGO_URI)}\x1b[0m`);
        console.log("⏳ Conectando ao Banco de Dados...");

        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Conexão estabelecida.");

        console.log("\n🔄 FASE 1: Sincronização de Mercado (Sync Preços)...");
        const startTime = Date.now();
        
        const result = await marketDataService.performFullSync();

        if (result.success) {
            console.log(`✅ SYNC OK! (${result.count} ativos)`);
            
            // EXECUTA O PROTOCOLO V3 AUTOMATICAMENTE
            console.log("\n🔄 FASE 2: Processamento de Inteligência (Protocolo V3)...");
            await runProtocolV3();

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log("\n==================================================");
            console.log(`✅ CICLO COMPLETO FINALIZADO!`);
            console.log(`⏱️  Tempo Total: ${duration}s`);
            console.log("==================================================\n");
            process.exit(0);
        } else {
            console.error("\n==================================================");
            console.error(`❌ FALHA NA FASE 1 (SYNC)`);
            console.error(`Motivo: ${result.error}`);
            console.error("==================================================\n");
            process.exit(1);
        }

    } catch (error) {
        console.error("\n❌ ERRO FATAL DE EXECUÇÃO:", error.message);
        process.exit(1);
    }
};

syncProd();
