import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Função auto-executável para inicialização segura
(async () => {
  try {
    // 1. Carrega Variáveis de Ambiente (PRIMEIRO DE TUDO)
    // Usamos import dinâmico para poder tratar erro se o pacote faltar
    const dotenv = (await import('dotenv')).default;
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const envPath = path.resolve(__dirname, '../.env');

    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    } else {
        dotenv.config();
    }

    // 2. Carrega Instrumentação (Sentry)
    // Importante: Carregar depois do dotenv para pegar o DSN do .env
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
      logger.error("❌ ERRO FATAL: JWT_SECRET não definido no .env");
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }

    app.listen(PORT, () => {
      logger.info(`🚀 Servidor Vértice Invest rodando na porta ${PORT}`);
      logger.info(`📡 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    console.error("\n❌ FALHA CRÍTICA NA INICIALIZAÇÃO:");
    
    // Tratamento amigável para erro de módulo não encontrado
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
        console.error("⚠️  DEPENDÊNCIAS NÃO ENCONTRADAS!");
        console.error("👉 Parece que você não instalou as dependências do servidor.");
        console.error("👉 Execute este comando na raiz do projeto para corrigir tudo:\n");
        console.error("   npm run setup\n");
    } else {
        console.error(error);
    }
    process.exit(1);
  }
})();