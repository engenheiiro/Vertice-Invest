import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { timeSeriesWorker } from '../services/workers/timeSeriesWorker.js';

// Configuração de ambiente para rodar via terminal
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tenta carregar .env da raiz do projeto
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

// Força modo local_sync
process.env.NODE_ENV = 'local_sync';

const syncTimeSeries = async () => {
    try {
        console.log("info: ⏰ Script: Sync Time Series - Iniciado");
        
        if (!process.env.MONGO_URI) {
            throw new Error("MONGO_URI não definida.");
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log("info: ℹ️ Conexão DB estabelecida.");

        console.log("info: 📈 Iniciando Cálculo de Séries Temporais (Volatilidade, Beta, SMA/EMA)...");
        await timeSeriesWorker.run();
        
        console.log("info: ✅ Script Finalizado com Sucesso.");
        process.exit(0);
    } catch (error) {
        console.error(`error: ❌ Erro Fatal no Script: ${error.message}`);
        process.exit(1);
    }
};

syncTimeSeries();
