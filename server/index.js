
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
    } catch {
        // Ignora falha de instrumentação
    }

    const { default: app } = await import('./app.js');
    const { default: connectDB } = await import('./config/db.js');
    const { default: logger } = await import('./config/logger.js');
    const { initScheduler } = await import('./services/schedulerService.js');
    const { logAiConfiguration, startApplication } = await import('./utils/serverStartup.js');

    // --- TRATAMENTO DE ERROS GLOBAIS ---
    process.on('uncaughtException', (error) => {
        const msg = `🔥 UNCAUGHT EXCEPTION!\nErro: ${error.message}\nStack: ${error.stack}`;
        if (logger) logger.error(msg);
        panicLog(msg);
        process.exit(1); 
    });

    process.on('unhandledRejection', (reason, _promise) => {
        const msg = `🔥 UNHANDLED REJECTION! Promessa sem catch.\nMotivo: ${reason instanceof Error ? reason.stack : reason}`;
        if (logger) logger.error(msg);
        panicLog(msg);
    });
    // ----------------------------------------------------------

    logger.info("⚡ [Boot] Inicializando servidor...");

    const PORT = process.env.PORT || 5000;
    const JWT_SECRET = process.env.JWT_SECRET;
    const API_KEY = process.env.API_KEY;

    if (!JWT_SECRET) {
      const msg = "❌ ERRO FATAL: JWT_SECRET não definido.";
      logger.error(msg);
      panicLog(msg);
    }

    logAiConfiguration(logger, API_KEY);

    // Preserva o fallback local de porta, mas transforma `listening` numa
    // promessa para que o scheduler só suba quando o socket estiver pronto.
    const listenOnPort = (port, allowFallback = true) => new Promise((resolve, reject) => {
      const handleStartupError = (error) => {
        if (error.code === 'EADDRINUSE' && allowFallback) {
          const fallbackPort = Number(port) + 1;
          logger.error(`❌ Porta ${port} já está em uso. Tentando ${fallbackPort}.`);
          setTimeout(() => {
            listenOnPort(fallbackPort, false).then(resolve, reject);
          }, 1000);
          return;
        }
        reject(error);
      };

      const candidate = app.listen(port, () => {
        // A partir daqui o listener permanente abaixo assume erros futuros; este
        // tratador cobre somente falhas durante a abertura inicial da porta.
        candidate.off('error', handleStartupError);
        logger.info(`🚀 Servidor Vértice Invest rodando na porta ${port}`);
        logger.info(`📡 Ambiente: ${process.env.NODE_ENV || 'development'}`);
        resolve(candidate);
      });

      candidate.once('error', handleStartupError);
    });

    const server = await startApplication({
      connectDB,
      listen: () => listenOnPort(PORT),
      initScheduler,
    });

    server.on('error', (e) => {
        logger.error(`❌ Erro no servidor: ${e.message}`);
    });

  } catch (error) {
    console.error("\n❌ FALHA CRÍTICA NA INICIALIZAÇÃO:");
    console.error(error);
    panicLog(`FALHA DE INICIALIZAÇÃO: ${error.message}\n${error.stack}`);
    process.exit(1);
  }
})();
