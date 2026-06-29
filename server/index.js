
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Função auxiliar para log de pânico segura
const panicLog = (message) => {
    const timestamp = new Date().toISOString();
    const logMsg = `\n[${timestamp}] CRITICAL CRASH:\n${message}\n--------------------------\n`;
    
    // Sempre loga no console (stderr) para captura por ferramentas de monitoramento (CloudWatch, Datadog, Render Logs)
    console.error(logMsg);

    // Tenta gravar em disco apenas se estiver em ambiente local ou explicitamente configurado
    // Em produção (Render/Vercel/Heroku), o FS pode ser efêmero ou read-only
    if (process.env.NODE_ENV !== 'production') {
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const logDir = path.join(__dirname, 'logs');
            const logPath = path.join(logDir, 'crash-report.txt');
            
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            
            fs.appendFileSync(logPath, logMsg);
            console.error("🔥 ERRO GRAVADO LOCALMENTE EM: " + logPath);
        } catch (e) {
            console.error("⚠️ Falha ao gravar log em disco (ignorando):", e.message);
        }
    }
};

(async () => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const dotenv = (await import('dotenv')).default;

    // .env único na raiz do monorepo (em produção/Render as vars já vêm
    // injetadas pela plataforma, então isso é só para dev local).
    const envRoots = [
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../..'),
        process.cwd()
    ];

    const envPath = envRoots
        .map((root) => path.resolve(root, '.env'))
        .find((p) => fs.existsSync(p));

    dotenv.config(envPath ? { path: envPath } : undefined);

    try {
        await import('./instrument.js');
    } catch (e) {
        // Ignora falha de instrumentação
    }

    const { default: app } = await import('./app.js');
    const { default: connectDB } = await import('./config/db.js');
    const { default: logger } = await import('./config/logger.js');

    // --- TRATAMENTO DE ERROS GLOBAIS ---
    process.on('uncaughtException', (error) => {
        const msg = `🔥 UNCAUGHT EXCEPTION!\nErro: ${error.message}\nStack: ${error.stack}`;
        if (logger) logger.error(msg);
        panicLog(msg);
        process.exit(1); 
    });

    process.on('unhandledRejection', (reason, promise) => {
        const msg = `🔥 UNHANDLED REJECTION! Promessa sem catch.\nMotivo: ${reason instanceof Error ? reason.stack : reason}`;
        if (logger) logger.error(msg);
        panicLog(msg);
    });
    // ----------------------------------------------------------

    logger.info("⚡ [Boot] Inicializando servidor...");

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
        logger.info(`🧠 [AI] Google Gemini: Conectado (Key: ${API_KEY.substring(0, 4)}...)`);
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
