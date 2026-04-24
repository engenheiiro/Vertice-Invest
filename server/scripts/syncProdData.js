
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { syncService } from '../services/syncService.js';
import { aiResearchService } from '../services/aiResearchService.js';
import { signalEngine } from '../services/engines/signalEngine.js';
import { runBacktestAnalysis } from './runBacktestEngine.js';

// Configuração de ambiente para rodar via terminal
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tenta carregar .env da raiz do projeto
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

// Força modo local_sync para permitir scraping
process.env.NODE_ENV = 'local_sync';

const syncProd = async () => {
    try {
        console.log("info: ⏰ Script: Sync Prod Data - Iniciado");
        
        if (!process.env.MONGO_URI) {
            throw new Error("MONGO_URI não definida.");
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log("info: ℹ️ Conexão DB estabelecida.");

        // 1. Coleta de Dados (Scraping + APIs)
        const result = await syncService.performFullSync();

        if (result.success) {
            console.log(`info: ℹ️ Sync Mercado OK (${result.count} ativos).`);
            
            // 2. Processamento de Inteligência (Centralizado)
            await aiResearchService.runBatchAnalysis(null);
            console.log("info: ℹ️ Processamento IA finalizado.");

            // 3. Radar Alpha & Backtest (NOVO)
            console.log("info: 📡 Rodando Radar Alpha e Auditoria...");
            const scanResult = await signalEngine.runScanner();
            
            // Log de Telemetria Granular
            if (scanResult.success) {
                console.log(`info: ✅ [Radar Alpha] Varredura: ${scanResult.analyzed} ativos analisados. ${scanResult.ignored} ignorados (duplicidade). ${scanResult.signals} novos sinais gerados.`);
            } else {
                console.log(`info: ⚠️ [Radar Alpha] Aviso: ${scanResult.error}`);
            }
            
            const backtestResult = await signalEngine.runBacktest();
            console.log(`info: 🕵️ Backtest: ${backtestResult.processed || 0} sinais auditados.`);

            // 4. Auditoria de Precisão do Algoritmo (gráfico de acurácia)
            console.log("info: 📊 Rodando auditoria de precisão do algoritmo...");
            try {
                await runBacktestAnalysis();
                console.log("info: ✅ Auditoria de precisão concluída.");
            } catch (backtestErr) {
                console.log(`info: ⚠️ Auditoria de precisão falhou (não crítico): ${backtestErr.message}`);
            }

            console.log("info: ⏰ Script: Sync Prod Data - Finalizado");
            process.exit(0);
        } else {
            console.error(`error: ❌ Script: Sync Prod Data - Falha no Sync: ${result.error}`);
            process.exit(1);
        }

    } catch (error) {
        console.error(`error: ❌ Script: Sync Prod Data - Erro Fatal: ${error.message}`);
        process.exit(1);
    }
};

syncProd();
