
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAnalysis from '../models/MarketAnalysis.js';
import AlgorithmPerformance from '../models/AlgorithmPerformance.js';
import { marketDataService } from '../services/marketDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';

// Configuração de ambiente
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    blue: "\x1b[34m"
};

const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
};

// Busca histórico do Benchmark (IBOV) para cálculo de Alpha
const getBenchmarkReturn = async (startDate, endDate) => {
    try {
        const history = await marketDataService.getBenchmarkHistory('^BVSP');
        if (!history || history.length === 0) return 0;

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        // Encontra preços mais próximos
        const startPoint = history.find(h => h.date >= startStr) || history[0];
        const endPoint = history.find(h => h.date >= endStr) || history[history.length - 1];

        if (!startPoint || !endPoint) return 0;

        const startVal = startPoint.close || startPoint.adjClose;
        const endVal = endPoint.close || endPoint.adjClose;

        if (!startVal || startVal === 0) return 0;

        return ((endVal - startVal) / startVal) * 100;
    } catch (e) {
        console.error("Erro Benchmark:", e.message);
        return 0;
    }
};

const evaluatePeriod = async (days, assetClass) => {
    const now = new Date();
    const targetDate = new Date();
    targetDate.setDate(now.getDate() - days);
    
    // Busca relatório histórico
    const report = await MarketAnalysis.findOne({
        assetClass: assetClass,
        date: { $lte: targetDate },
        'content.ranking.4': { $exists: true } // Precisa ter pelo menos Top 5
    }).sort({ date: -1 });

    if (!report) {
        console.log(`${COLORS.yellow}⚠️  [${days}d] Sem histórico suficiente para ${assetClass}.${COLORS.reset}`);
        return null;
    }

    return processReport(report, days);
};

const processReport = async (report, daysAgo) => {
    // Analisa o TOP 5 (Diversificação simulada)
    const topPicks = report.content.ranking
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    if (topPicks.length === 0) return null;

    let totalReturn = 0;
    let hits = 0;
    const snapshot = [];
    let deviationAlert = false;

    // Busca Benchmark
    const benchmarkReturn = await getBenchmarkReturn(new Date(report.date), new Date());

    console.log(`   📅 Análise de ${daysAgo} dias atrás (${new Date(report.date).toLocaleDateString()})`);
    console.log(`      Benchmark (IBOV): ${benchmarkReturn >= 0 ? '+' : ''}${benchmarkReturn.toFixed(2)}%`);

    for (const pick of topPicks) {
        const entryPrice = pick.currentPrice;
        
        // Cotação Atual
        const currentData = await marketDataService.getMarketDataByTicker(pick.ticker);
        const currentPrice = currentData.price;

        if (!currentPrice || !entryPrice) continue;

        const rawReturn = (currentPrice - entryPrice) / entryPrice;
        const returnPercent = rawReturn * 100;
        
        totalReturn += returnPercent;
        if (returnPercent > 0) hits++;

        // Alerta de Desvio Grave (>15% de queda em ativo recomendado)
        if (returnPercent < -15) {
            deviationAlert = true;
            console.log(`${COLORS.red}      🚨 ALERTA: ${pick.ticker} caiu ${returnPercent.toFixed(2)}% (Tese invalidada?)${COLORS.reset}`);
        }

        snapshot.push({
            ticker: pick.ticker,
            startPrice: entryPrice,
            currentPrice: currentPrice,
            returnPercent
        });
    }

    const avgReturn = totalReturn / snapshot.length;
    const alpha = avgReturn - benchmarkReturn;
    const hitRate = (hits / snapshot.length) * 100;

    // Persistência
    await AlgorithmPerformance.create({
        date: new Date(),
        assetClass: report.assetClass,
        lookbackWindow: daysAgo,
        avgReturn,
        benchmarkReturn,
        alpha,
        topPicksSnapshot: snapshot,
        hitRate,
        deviationAlert
    });

    const alphaColor = alpha >= 0 ? COLORS.green : COLORS.red;
    console.log(`      Performance Média (Top 5): ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`);
    console.log(`      Alpha vs IBOV: ${alphaColor}${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%${COLORS.reset}`);

    return { avgReturn, alpha, hitRate };
};

const runBacktest = async () => {
    try {
        console.log(`\n${COLORS.bright}${COLORS.cyan}📡 VÉRTICE INVEST - CONTINUOUS AUDIT SYSTEM (v2.0)${COLORS.reset}`);
        console.log("=====================================================");
        
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI ausente.");
        await mongoose.connect(process.env.MONGO_URI);
        
        const periods = [30, 60, 90];
        const classes = ['STOCK', 'FII', 'BRASIL_10']; 

        for (const assetClass of classes) {
            console.log(`\n🔍 Auditando Classe: ${COLORS.bright}${assetClass}${COLORS.reset}`);
            
            for (const days of periods) {
                await evaluatePeriod(days, assetClass);
            }
        }

        console.log("\n=====================================================");
        console.log(`✅ Auditoria completa e salva em 'AlgorithmPerformance'.`);
        process.exit(0);

    } catch (error) {
        console.error(`${COLORS.red}❌ Erro Fatal no Backtest: ${error.message}${COLORS.reset}`);
        process.exit(1);
    }
};

runBacktest();
