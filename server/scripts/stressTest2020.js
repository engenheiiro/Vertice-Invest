
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import YahooFinance from 'yahoo-finance2';
import MarketAnalysis from '../models/MarketAnalysis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m"
};

const runStressTest = async () => {
    try {
        console.log(`\n${COLORS.bright}${COLORS.cyan}🧪 VÉRTICE INVEST - STRESS TEST (COVID-19 CRASH)${COLORS.reset}`);
        console.log("=====================================================");
        console.log("Simulando performance da carteira atual em Março/2020...");

        if (!process.env.MONGO_URI) throw new Error("MONGO_URI ausente.");
        await mongoose.connect(process.env.MONGO_URI);

        // Pega o último ranking Brasil 10
        const report = await MarketAnalysis.findOne({ assetClass: 'BRASIL_10', isRankingPublished: true }).sort({ createdAt: -1 });
        
        if (!report || !report.content.ranking) {
            console.error("❌ Nenhum ranking Brasil 10 encontrado para testar.");
            process.exit(1);
        }

        const tickers = report.content.ranking.map(r => r.ticker + (r.ticker.includes('11') || r.ticker.match(/[3456]$/) ? '.SA' : ''));
        console.log(`\nAtivos sob teste: ${tickers.join(', ')}`);

        // Período do Crash: 20 Fev 2020 - 23 Mar 2020
        const period1 = '2020-02-15';
        const period2 = '2020-03-30';

        let totalDrawdown = 0;
        let count = 0;

        for (const ticker of tickers) {
            try {
                const history = await YahooFinance.chart(ticker, { period1, period2, interval: '1d' });
                if (history && history.quotes && history.quotes.length > 0) {
                    const closes = history.quotes.map(q => q.close);
                    const peak = Math.max(...closes);
                    const trough = Math.min(...closes);
                    const drawdown = ((trough - peak) / peak) * 100;
                    
                    console.log(`${ticker}: Peak ${peak.toFixed(2)} -> Low ${trough.toFixed(2)} = ${drawdown < -40 ? COLORS.red : COLORS.yellow}${drawdown.toFixed(2)}%${COLORS.reset}`);
                    
                    totalDrawdown += drawdown;
                    count++;
                } else {
                    console.log(`${ticker}: Sem dados históricos para 2020.`);
                }
            } catch (e) {
                console.log(`${ticker}: Falha ao buscar dados (${e.message}).`);
            }
        }

        const avgDrawdown = count > 0 ? totalDrawdown / count : 0;
        const ibovDrawdown = -45.0; // Benchmark Aproximado

        console.log("\n-----------------------------------------------------");
        console.log(`📉 Drawdown Médio da Carteira: ${avgDrawdown.toFixed(2)}%`);
        console.log(`📉 Benchmark (IBOV) na época: ${ibovDrawdown.toFixed(2)}%`);
        
        if (avgDrawdown > ibovDrawdown) {
            console.log(`\n✅ ${COLORS.green}APROVADO: A carteira caiu MENOS que o mercado (Defensiva).${COLORS.reset}`);
        } else {
            console.log(`\n⚠️ ${COLORS.red}ALERTA: A carteira caiu MAIS que o mercado (Alta Volatilidade).${COLORS.reset}`);
        }

        process.exit(0);

    } catch (error) {
        console.error("Erro Fatal:", error);
        process.exit(1);
    }
};

runStressTest();
