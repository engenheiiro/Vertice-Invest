
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { syncService } from '../services/syncService.js';
import { marketDataService } from '../services/marketDataService.js';
import { aiResearchService } from '../services/aiResearchService.js';
import { signalEngine } from '../services/engines/signalEngine.js';
import { timeSeriesWorker } from '../services/workers/timeSeriesWorker.js';
import { runBacktestAnalysis } from './runBacktestEngine.js';
import { logDir } from '../config/logger.js';
import { createSyncReporter } from './syncReporter.js';

// Configuração de ambiente para rodar via terminal
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tenta carregar .env da raiz do projeto
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

// Força modo local_sync para permitir scraping
process.env.NODE_ENV = 'local_sync';

// Terminal minimalista (só etapa + progresso); todo o detalhe (info/warn/debug/
// error) vai para o TXT abaixo, sobrescrito a cada run.
const reportFile = path.join(logDir, 'sync-report.txt');
const reporter = createSyncReporter({ reportFile, title: 'sync:prod' });

const syncProd = async () => {
    let success = false;
    reporter.begin();

    try {
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI não definida.');
        }

        await reporter.runStage('Conexão com o banco', async () => {
            await mongoose.connect(process.env.MONGO_URI);
        });

        // 1. Coleta de Dados (Scraping + APIs)
        const result = await reporter.runStage('Cotações & mercado', async () => {
            const r = await syncService.performFullSync();
            if (!r.success) throw new Error(r.error || 'Falha no sync de mercado');
            return r;
        });
        if (result.fundamentals) {
            reporter.detail(
                `STOCK ${result.fundamentals.STOCK.accepted}/${result.fundamentals.STOCK.parsed} · ` +
                `FII ${result.fundamentals.FII.accepted}/${result.fundamentals.FII.parsed} aceitos · ` +
                `${result.count} operações totais`
            );
        } else {
            reporter.detail(`${result.count} operações totais`);
        }

        // 1.2 Reativação: re-cota os ativos inativos e reativa os que voltaram a
        // cotar (ex.: B3SA3 após o fix de fallback). O sync regular só cota ATIVOS,
        // então sem esta etapa um inativo recuperável nunca volta pelo sync manual —
        // só pela rotina agendada (schedulerService). Rodamos antes das séries para
        // que o reativado já entre no ranking.
        await reporter.runStage(
            'Reativação de inativos',
            async () => {
                const r = await marketDataService.tryReactivateAssets();
                reporter.detail(`${r.reactivated} reativados, ${r.stillInactive} ainda inativos`);
            },
            { critical: false }
        );

        // 1.5 Séries temporais ANTES do ranking: recalcula beta/volatility/SMA/EMA
        // a partir do histórico. O scoringEngine usa beta/volatility no gate de
        // elegibilidade e nos scores, então isto precisa rodar antes do batch
        // (mesma ordem da rotina das 18:30).
        await reporter.runStage('Séries temporais', async () => {
            await timeSeriesWorker.run();
        });

        // 2. Processamento de Inteligência (Centralizado)
        await reporter.runStage('Inteligência / ranking', async () => {
            await aiResearchService.runBatchAnalysis(null);
        });

        // 3. Radar Alpha & Backtest de sinais
        await reporter.runStage('Radar Alpha', async () => {
            const scanResult = await signalEngine.runScanner();
            const backtestResult = await signalEngine.runBacktest();
            const parts = [];
            if (scanResult.success) parts.push(`${scanResult.signals} sinais`);
            parts.push(`${backtestResult.processed || 0} auditados`);
            reporter.detail(parts.join(', '));
        });

        // 4. Auditoria de Precisão do Algoritmo (gráfico de acurácia) — não crítica.
        await reporter.runStage(
            'Auditoria de precisão',
            async () => {
                await runBacktestAnalysis();
            },
            { critical: false }
        );

        success = true;
    } catch (error) {
        reporter.fatalError(error);
    } finally {
        reporter.finish({ success });
        await mongoose.disconnect().catch(() => {});
        process.exit(success ? 0 : 1);
    }
};

syncProd();
