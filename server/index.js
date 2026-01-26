
console.log("⚡ [Boot] Iniciando processo Node.js...");

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Função auto-executável para inicialização segura
(async () => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    console.log("📂 [Boot] Carregando variáveis de ambiente...");

    // 1. Carrega Variáveis de Ambiente
    const dotenv = (await import('dotenv')).default;
    
    // Procura o .env na raiz do projeto ou no diretório atual
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
        // Tenta carregar sem caminho específico (pega do ambiente real do Render/Vercel)
        dotenv.config();
        console.log("⚠️ [Boot] .env local não encontrado (usando variáveis de sistema).");
    }

    // 2. Carrega Instrumentação (Sentry)
    try {
        await import('./instrument.js');
    } catch (e) {
        console.warn("⚠️ [Boot] Falha ao carregar instrumentação (ignorado):", e.message);
    }

    // 3. Importa Módulos Core
    console.log("🔄 [Boot] Importando módulos da aplicação...");
    const { default: app } = await import('./app.js');
    const { default: connectDB } = await import('./config/db.js');
    const { default: logger } = await import('./config/logger.js');

    // 4. Inicializa Banco e Servidor
    await connectDB();

    const PORT = process.env.PORT || 5000;
    const JWT_SECRET = process.env.JWT_SECRET;
    const API_KEY = process.env.API_KEY;

    if (!JWT_SECRET) {
      logger.error("❌ ERRO FATAL: JWT_SECRET não definido.");
      if (process.env.NODE_ENV === 'production') {
          console.error("Aplicação não pode iniciar sem JWT_SECRET em produção.");
      }
    }

    if (!API_KEY) {
        logger.warn("⚠️ AVISO: API_KEY do Google Gemini não encontrada. A IA não funcionará.");
    } else {
        logger.info(`🔑 API Key detectada (${API_KEY.substring(0, 4)}...${API_KEY.substring(API_KEY.length - 4)})`);
    }

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Servidor Vértice Invest rodando na porta ${PORT}`);
      logger.info(`📡 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            logger.error(`❌ Porta ${PORT} já está em uso!`);
            logger.info(`👉 Tentando iniciar na porta ${Number(PORT) + 1}...`);
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
    process.exit(1);
  }
})();
