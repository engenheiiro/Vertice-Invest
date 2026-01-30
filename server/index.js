
console.log("⚡ [Boot] Iniciando processo Node.js...");

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Função auxiliar para log de pânico (escreve direto no disco sem depender de bibliotecas)
const panicLog = (message) => {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const logPath = path.join(__dirname, 'logs', 'crash-report.txt');
        const timestamp = new Date().toISOString();
        const logMsg = `\n[${timestamp}] CRITICAL CRASH:\n${message}\n--------------------------\n`;
        
        // Garante que a pasta existe (redundância)
        if (!fs.existsSync(path.join(__dirname, 'logs'))) {
            fs.mkdirSync(path.join(__dirname, 'logs'));
        }
        
        fs.appendFileSync(logPath, logMsg);
        console.error("🔥 ERRO GRAVADO EM: " + logPath);
    } catch (e) {
        console.error("ERRO AO GRAVAR LOG DE PÂNICO:", e);
    }
};

(async () => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    console.log("📂 [Boot] Carregando variáveis de ambiente...");

    const dotenv = (await import('dotenv')).default;
    
    const envPaths = [
        path.resolve(__dirname, '../.env'),
        path.resolve(__dirname, '../../.env'),
        path.resolve(process.cwd(), '.env')
    ];

    let envLoaded = false;
    for (const p of envPaths) {
        if (fs.existsSync(p)) {
            dotenv.config({ path: p });
            envLoaded = true;
            console.log(`✅ [Boot] .env carregado de: ${p}`);
            break;
        }
    }

    if (!envLoaded) {
        dotenv.config();
        console.log("⚠️ [Boot] .env local não encontrado (usando variáveis de sistema).");
    }

    try {
        await import('./instrument.js');
    } catch (e) {
        console.warn("⚠️ [Boot] Falha ao carregar instrumentação (ignorado):", e.message);
    }

    console.log("🔄 [Boot] Importando módulos da aplicação...");
    const { default: app } = await import('./app.js');
    const { default: connectDB } = await import('./config/db.js');
    const { default: logger } = await import('./config/logger.js');

    // --- TRATAMENTO DE ERROS GLOBAIS ---
    process.on('uncaughtException', (error) => {
        const msg = `🔥 UNCAUGHT EXCEPTION!\nErro: ${error.message}\nStack: ${error.stack}`;
        console.error(msg);
        
        // Tenta usar o logger padrão
        if (logger) logger.error(msg);
        
        // Log de Pânico (Garante escrita em arquivo txt simples)
        panicLog(msg);

        process.exit(1); 
    });

    process.on('unhandledRejection', (reason, promise) => {
        const msg = `🔥 UNHANDLED REJECTION! Promessa sem catch.\nMotivo: ${reason instanceof Error ? reason.stack : reason}`;
        console.error(msg);
        if (logger) logger.error(msg);
        
        // Em casos severos, unhandledRejection pode deixar o app instável
        // Vamos logar no pânico também por segurança
        panicLog(msg);
    });
    // ----------------------------------------------------------

    await connectDB();

    const PORT = process.env.PORT || 5000;
    const JWT_SECRET = process.env.JWT_SECRET;
    const API_KEY = process.env.API_KEY;

    if (!JWT_SECRET) {
      const msg = "❌ ERRO FATAL: JWT_SECRET não definido.";
      logger.error(msg);
      panicLog(msg);
    }

    if (!API_KEY) {
        logger.warn("⚠️ AVISO: API_KEY do Google Gemini não encontrada.");
    } else {
        logger.info(`🔑 API Key detectada (${API_KEY.substring(0, 4)}...)`);
    }

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Servidor Vértice Invest rodando na porta ${PORT}`);
      logger.info(`📡 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            logger.error(`❌ Porta ${PORT} já está em uso!`);
            setTimeout(() => {
                server.close();
                app.listen(Number(PORT) + 1);
            }, 1000);
        } else {
            logger.error(`❌ Erro no servidor: ${e.message}`);
        }
    });

  } catch (error) {
    console.error("\n❌ FALHA CRÍTICA NA INICIALIZAÇÃO:");
    console.error(error);
    panicLog(`FALHA DE INICIALIZAÇÃO: ${error.message}\n${error.stack}`);
    process.exit(1);
  }
})();
