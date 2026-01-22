
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Função auto-executável para inicialização segura
(async () => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

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
            break;
        }
    }

    if (!envLoaded) {
        // Tenta carregar sem caminho específico (pega do ambiente real do Render/Vercel)
        dotenv.config();
    }

    // 2. Carrega Instrumentação (Sentry)
    await import('./instrument.js');

    // 3. Importa Módulos Core
    const { default: app } = await import('./app.js');
    const { default: connectDB } = await import('./config/db.js');
    const { default: logger } = await import('./config/logger.js');

    // 4. Inicializa Banco e Servidor
    await connectDB();

    const PORT = process.env.PORT || 5000;
    const JWT_SECRET = process.env.JWT_SECRET;

    if (!JWT_SECRET) {
      logger.error("❌ ERRO FATAL: JWT_SECRET não definido.");
      if (process.env.NODE_ENV === 'production') {
          console.error("Aplicação não pode iniciar sem JWT_SECRET em produção.");
          // No Render, as variáveis de ambiente são configuradas no painel.
      }
    }

    app.listen(PORT, () => {
      logger.info(`🚀 Servidor Vértice Invest rodando na porta ${PORT}`);
      logger.info(`📡 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    console.error("\n❌ FALHA CRÍTICA NA INICIALIZAÇÃO:");
    console.error(error);
    process.exit(1);
  }
})();
