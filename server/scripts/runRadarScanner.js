
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { signalEngine } from '../services/engines/signalEngine.js';
import { runBacktestAnalysis } from './runBacktestEngine.js';
import { generateRadarReport } from './generateRadarReport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.NODE_ENV = 'local_sync';

const run = async () => {
    try {
        if (!process.env.MONGO_URI) throw new Error('MONGO_URI não definida.');

        await mongoose.connect(process.env.MONGO_URI);
        console.log('info: ℹ️ DB conectado.');

        console.log('info: 📡 Rodando varredura do Radar Alpha...');
        const scanResult = await signalEngine.runScanner();
        if (scanResult.success) {
            console.log(`info: ✅ Varredura: ${scanResult.analyzed} ativos, ${scanResult.signals} sinais, ${scanResult.staleInactivated ?? 0} inativados.`);
        } else {
            console.log(`info: ⚠️ Varredura com aviso: ${scanResult.error}`);
        }

        console.log('info: 🕵️ Rodando backtest dos sinais ativos...');
        const backtestResult = await signalEngine.runBacktest();
        console.log(`info: ✅ Backtest: ${backtestResult.processed || 0} sinais auditados (Hits: ${backtestResult.hits || 0} | Stops: ${backtestResult.misses || 0}).`);

        console.log('info: 📊 Rodando auditoria de precisão...');
        try {
            await runBacktestAnalysis();
            console.log('info: ✅ Auditoria concluída.');
        } catch (e) {
            console.log(`info: ⚠️ Auditoria falhou (não crítico): ${e.message}`);
        }

        console.log('info: 📄 Gerando relatório radar_latest.txt...');
        await generateRadarReport();

        console.log('info: ✅ Radar Alpha atualizado com sucesso.');
        process.exit(0);
    } catch (error) {
        console.error(`error: ❌ Erro fatal: ${error.message}`);
        process.exit(1);
    }
};

run();
