
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { syncService } from '../services/syncService.js'; 
import { aiResearchService } from '../services/aiResearchService.js';

// Configuração de ambiente para rodar via terminal
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tenta carregar .env da raiz do projeto
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

// Força modo local_sync para permitir scraping
process.env.NODE_ENV = 'local_sync';

const maskUri = (uri) => {
    if (!uri) return 'UNDEFINED';
    if (uri.includes('localhost') || uri.includes('127.0.0.1')) return 'LOCALHOST (Ambiente de Teste)';
    return 'ATLAS CLOUD (Produção/Remoto) ☁️';
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
        
        // 1. Coleta de Dados (Scraping + APIs)
        const result = await syncService.performFullSync();

        if (result.success) {
            console.log(`✅ SYNC OK! (${result.count} ativos atualizados)`);
            
            // 2. Processamento de Inteligência (Centralizado)
            console.log("\n🔄 FASE 2: Processamento de Inteligência (Protocolo V3)...");
            
            // CHAMA O SERVIÇO CENTRALIZADO - NÃO DUPLICAR LÓGICA AQUI
            await aiResearchService.runBatchAnalysis(null);

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
