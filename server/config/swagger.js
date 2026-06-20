/**
 * (I7) Documentação OpenAPI 3 / Swagger.
 *
 * 100% local: swagger-jsdoc gera o spec a partir desta definição (+ eventuais
 * comentários @openapi nas rotas) e swagger-ui-express serve a UI em /api/docs.
 * Sem serviço externo, sem custo. A definição abaixo cobre a superfície
 * principal da API; novas rotas podem ser anotadas com JSDoc e aparecem aqui.
 */
import swaggerJSDoc from 'swagger-jsdoc';

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'Vértice Invest API',
    version: '1.6.2',
    description:
      'API da plataforma de análise quantitativa (Ações, FIIs, Cripto). ' +
      'Autenticação via Bearer JWT no header `Authorization`. ' +
      'Rotas de escrita têm rate limiting por usuário.',
  },
  servers: [
    { url: '/api', description: 'Servidor atual (relativo)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { message: { type: 'string', example: 'Mensagem de erro.' } },
      },
      Credenciais: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'user@exemplo.com' },
          password: { type: 'string', format: 'password', example: 'SenhaForte1' },
        },
      },
      Registro: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', example: 'Maria Silva' },
          email: { type: 'string', format: 'email' },
          password: {
            type: 'string',
            description: 'Mín. 8 chars, com maiúscula, minúscula e dígito; não pode ser senha comum.',
          },
        },
      },
      TransacaoCarteira: {
        type: 'object',
        required: ['ticker', 'quantity', 'price'],
        properties: {
          ticker: { type: 'string', example: 'PETR4' },
          type: { type: 'string', enum: ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME', 'CASH'] },
          quantity: { type: 'number', description: 'Positivo = compra, negativo = venda.', example: 100 },
          price: { type: 'number', minimum: 0, example: 38.5 },
          date: { type: 'string', format: 'date', example: '2026-05-30' },
          fixedIncomeRate: { type: 'number', nullable: true },
          name: { type: 'string', nullable: true },
        },
      },
    },
  },
  // Aplica Bearer por padrão; rotas públicas sobrescrevem com `security: []`.
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Autenticação e conta' },
    { name: 'MFA', description: 'Autenticação em dois fatores (TOTP)' },
    { name: 'Wallet', description: 'Carteira, transações e performance' },
    { name: 'Research', description: 'Ranking, macro e sinais' },
    { name: 'Research (Admin)', description: 'Pipeline, sync e tunables — exige role ADMIN' },
    { name: 'Market', description: 'Cotações' },
    { name: 'Subscription', description: 'Planos e pagamentos' },
    { name: 'Goals', description: 'Metas financeiras e aportes' },
    { name: 'Academy', description: 'Cursos, lições e quizzes' },
    { name: 'Notifications', description: 'Notificações do usuário' },
    { name: 'Webhooks', description: 'Callbacks de provedores externos' },
  ],
  paths: {
    // ===================== AUTH =====================
    '/register': {
      post: {
        tags: ['Auth'], summary: 'Cria uma nova conta', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Registro' } } } },
        responses: { 201: { description: 'Conta criada' }, 400: { description: 'Validação falhou', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
    },
    '/login': {
      post: {
        tags: ['Auth'], summary: 'Autentica e retorna tokens', security: [],
        description: 'Aceita `mfaToken` opcional. Se o MFA estiver ativo e o token faltar, responde `{ mfaRequired: true }`.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Credenciais' } } } },
        responses: { 200: { description: 'Autenticado (accessToken + refresh cookie) ou mfaRequired' }, 401: { description: 'Credenciais inválidas' } },
      },
    },
    '/refresh': {
      post: { tags: ['Auth'], summary: 'Renova o access token via refresh cookie', security: [], responses: { 200: { description: 'Novo access token' }, 401: { description: 'Refresh inválido' } } },
    },
    '/logout': {
      post: { tags: ['Auth'], summary: 'Encerra a sessão e invalida o refresh token', security: [], responses: { 200: { description: 'Sessão encerrada' } } },
    },
    '/forgot-password': {
      post: {
        tags: ['Auth'], summary: 'Envia e-mail de redefinição de senha', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } } },
        responses: { 200: { description: 'Se o e-mail existir, um link foi enviado' } },
      },
    },
    '/reset-password': {
      post: {
        tags: ['Auth'], summary: 'Redefine a senha com o token recebido por e-mail', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token', 'password'], properties: { token: { type: 'string' }, password: { type: 'string', format: 'password' } } } } } },
        responses: { 200: { description: 'Senha redefinida' }, 400: { description: 'Token inválido/expirado' } },
      },
    },
    '/me': {
      put: { tags: ['Auth'], summary: 'Atualiza perfil (nome, CPF, dados pessoais)', responses: { 200: { description: 'Perfil atualizado' }, 409: { description: 'CPF já utilizado' } } },
      delete: { tags: ['Auth'], summary: 'Exclui a conta (LGPD)', responses: { 200: { description: 'Conta excluída' }, 429: { description: 'Rate limit' } } },
    },
    '/me/avatar': {
      put: { tags: ['Auth'], summary: 'Define/atualiza o avatar (base64)', responses: { 200: { description: 'Avatar atualizado' }, 400: { description: 'Imagem inválida' }, 429: { description: 'Rate limit' } } },
      delete: { tags: ['Auth'], summary: 'Remove o avatar', responses: { 200: { description: 'Avatar removido' } } },
    },
    '/change-password': {
      post: {
        tags: ['Auth'], summary: 'Troca a senha do usuário autenticado',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password' }, newPassword: { type: 'string', format: 'password' } } } } } },
        responses: { 200: { description: 'Senha alterada' }, 400: { description: 'Senha atual incorreta/nova inválida' } },
      },
    },
    '/tutorial-seen': {
      post: { tags: ['Auth'], summary: 'Marca o tutorial/onboarding como visto', responses: { 200: { description: 'Atualizado' } } },
    },
    '/me/deactivate': {
      post: { tags: ['Auth'], summary: 'Desativa a conta (soft)', responses: { 200: { description: 'Conta desativada' } } },
    },
    '/me/export': {
      get: { tags: ['Auth'], summary: 'Exporta os dados do usuário (LGPD)', responses: { 200: { description: 'Pacote de dados' }, 429: { description: 'Rate limit' } } },
    },

    // ===================== MFA =====================
    '/mfa/status': {
      get: { tags: ['MFA'], summary: 'Informa se o MFA está ativo', responses: { 200: { description: '{ enabled: boolean }' } } },
    },
    '/mfa/setup': {
      post: { tags: ['MFA'], summary: 'Inicia setup do TOTP (retorna otpauth/QR)', responses: { 200: { description: 'Segredo + otpauth URL' } } },
    },
    '/mfa/enable': {
      post: {
        tags: ['MFA'], summary: 'Confirma e ativa o MFA',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string', example: '123456' } } } } } },
        responses: { 200: { description: 'MFA ativado' }, 400: { description: 'Token inválido' } },
      },
    },
    '/mfa/disable': {
      post: { tags: ['MFA'], summary: 'Desativa o MFA', responses: { 200: { description: 'MFA desativado' }, 400: { description: 'Token inválido' } } },
    },

    // ===================== WALLET =====================
    '/wallet': {
      get: { tags: ['Wallet'], summary: 'Carteira consolidada + KPIs', responses: { 200: { description: 'Ativos e KPIs' }, 401: { description: 'Não autenticado' } } },
    },
    '/wallet/history': {
      get: { tags: ['Wallet'], summary: 'Snapshots patrimoniais diários', responses: { 200: { description: 'Série de WalletSnapshot' } } },
    },
    '/wallet/search': {
      get: { tags: ['Wallet'], summary: 'Busca tickers para autocompletar', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Resultados' } } },
    },
    '/wallet/add': {
      post: {
        tags: ['Wallet'], summary: 'Registra uma transação (compra/venda)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransacaoCarteira' } } } },
        responses: { 201: { description: 'Transação registrada' }, 400: { description: 'Validação falhou' }, 429: { description: 'Rate limit por usuário' } },
      },
    },
    '/wallet/reset': {
      post: { tags: ['Wallet'], summary: 'Zera a carteira do usuário', responses: { 200: { description: 'Carteira resetada' }, 429: { description: 'Rate limit' } } },
    },
    '/wallet/targets': {
      put: { tags: ['Wallet'], summary: 'Define metas de alocação por classe/ativo', responses: { 200: { description: 'Metas atualizadas' }, 400: { description: 'Validação falhou' } } },
    },
    '/wallet/{id}': {
      put: { tags: ['Wallet'], summary: 'Atualiza tags/nome do ativo', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Atualizado' }, 404: { description: 'Ativo não encontrado' } } },
      delete: { tags: ['Wallet'], summary: 'Remove ativo e suas transações', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removido' }, 404: { description: 'Não encontrado' } } },
    },
    '/wallet/transactions/{ticker}': {
      get: { tags: ['Wallet'], summary: 'Transações de um ticker', parameters: [{ name: 'ticker', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Lista de transações' } } },
    },
    '/wallet/transactions/{id}': {
      delete: { tags: ['Wallet'], summary: 'Remove uma transação (recalcula posição)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Transação removida' }, 404: { description: 'Não encontrada' } } },
    },
    '/wallet/performance': {
      get: { tags: ['Wallet'], summary: 'Série histórica TWRR vs benchmarks (CDI/IPCA/IBOV)', responses: { 200: { description: 'Histórico + stats (sharpe/beta)' } } },
    },
    '/wallet/dividends': {
      get: { tags: ['Wallet'], summary: 'Proventos recebidos e provisionados', responses: { 200: { description: 'Dividendos por mês + projeção' } } },
    },
    '/wallet/cashflow': {
      get: { tags: ['Wallet'], summary: 'Fluxo de caixa de aportes/resgates', responses: { 200: { description: 'Fluxo de caixa' } } },
    },
    '/wallet/rebalance': {
      post: { tags: ['Wallet'], summary: 'Plano de rebalanceamento por IA (plano BLACK)', responses: { 200: { description: 'Plano de rebalanceamento' }, 403: { description: 'Plano insuficiente' }, 429: { description: 'Rate limit' } } },
    },
    '/wallet/fix-splits': {
      post: { tags: ['Wallet'], summary: 'Aplica desdobramentos/grupamentos a um ativo', responses: { 200: { description: 'Ajuste aplicado' }, 400: { description: 'Validação falhou' } } },
    },
    '/wallet/fix-snapshots': {
      post: { tags: ['Wallet'], summary: 'Recalcula snapshots (admin)', responses: { 200: { description: 'Snapshots recalculados' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/wallet/snapshot-health': {
      get: { tags: ['Wallet'], summary: 'Diagnóstico de integridade dos snapshots (admin)', responses: { 200: { description: 'Relatório de saúde' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/wallet/admin/snapshot/force': {
      post: { tags: ['Wallet'], summary: 'Força o snapshot diário (admin)', responses: { 200: { description: 'Snapshot gerado' }, 403: { description: 'Requer ADMIN' } } },
    },

    // ===================== RESEARCH (leitura) =====================
    '/research/latest': {
      get: { tags: ['Research'], summary: 'Último ranking publicado', parameters: [{ name: 'assetClass', in: 'query', schema: { type: 'string', enum: ['STOCK', 'FII', 'CRYPTO'] } }], responses: { 200: { description: 'Ranking' } } },
    },
    '/research/macro': {
      get: { tags: ['Research'], summary: 'Indicadores macro (SELIC, IPCA, CDI, IBOV)', responses: { 200: { description: 'Macro atual' } } },
    },
    '/research/signals': {
      get: { tags: ['Research'], summary: 'Sinais técnicos (RSI/Volume/Suporte)', responses: { 200: { description: 'Sinais' } } },
    },
    '/research/radar-stats': {
      get: { tags: ['Research'], summary: 'Estatísticas do Radar Alpha', responses: { 200: { description: 'Métricas do radar' } } },
    },
    '/research/discard-logs': {
      get: { tags: ['Research'], summary: 'Ativos descartados na última run', responses: { 200: { description: 'DiscardLog[]' } } },
    },

    // ===================== RESEARCH (admin) =====================
    '/research/crunch': {
      post: { tags: ['Research (Admin)'], summary: 'Recalcula o ranking a partir do cache', responses: { 200: { description: 'Ranking recalculado' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/full-pipeline': {
      post: { tags: ['Research (Admin)'], summary: 'Executa o pipeline completo (sync + crunch + publish)', responses: { 202: { description: 'Pipeline iniciado' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/enhance': {
      post: { tags: ['Research (Admin)'], summary: 'Enriquece o ranking com narrativas de IA', responses: { 200: { description: 'Enriquecido' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/narrative': {
      post: { tags: ['Research (Admin)'], summary: 'Gera narrativa (Morning Call) via IA', responses: { 200: { description: 'Narrativa gerada' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/publish': {
      post: { tags: ['Research (Admin)'], summary: 'Publica o ranking calculado', responses: { 200: { description: 'Publicado' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/history': {
      get: { tags: ['Research (Admin)'], summary: 'Lista relatórios MarketAnalysis', responses: { 200: { description: 'Relatórios' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/details/{id}': {
      get: { tags: ['Research (Admin)'], summary: 'Detalhe de um relatório', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Relatório' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/sync-market': {
      post: { tags: ['Research (Admin)'], summary: 'Sincroniza dados de mercado (scraping/cotações)', responses: { 202: { description: 'Sync iniciado' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/backfill-sectors': {
      post: { tags: ['Research (Admin)'], summary: 'Preenche setores faltantes', responses: { 200: { description: 'Backfill executado' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/sync-macro': {
      post: { tags: ['Research (Admin)'], summary: 'Sincroniza indicadores macro', responses: { 200: { description: 'Macro atualizado' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/sync-time-series': {
      post: { tags: ['Research (Admin)'], summary: 'Recalcula séries temporais', responses: { 202: { description: 'Sync iniciado' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/config/backtest': {
      post: { tags: ['Research (Admin)'], summary: 'Atualiza configuração de backtest', responses: { 200: { description: 'Config salva' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/config/tunables': {
      get: { tags: ['Research (Admin)'], summary: 'Lê os tunables editáveis', responses: { 200: { description: 'Tunables' }, 403: { description: 'Requer ADMIN' } } },
      put: { tags: ['Research (Admin)'], summary: 'Atualiza tunables (sem deploy)', responses: { 200: { description: 'Tunables atualizados' }, 400: { description: 'Validação falhou' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/signals/history': {
      delete: { tags: ['Research (Admin)'], summary: 'Limpa o histórico do radar', responses: { 200: { description: 'Histórico limpo' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/cleanup-storage': {
      post: { tags: ['Research (Admin)'], summary: 'Limpa storage antigo', responses: { 200: { description: 'Limpeza executada' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/data-quality': {
      get: { tags: ['Research (Admin)'], summary: 'Estatísticas de qualidade dos dados', responses: { 200: { description: 'Métricas' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/reset-health': {
      post: { tags: ['Research (Admin)'], summary: 'Reseta flags de saúde dos ativos', responses: { 200: { description: 'Resetado' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/accuracy': {
      get: { tags: ['Research (Admin)'], summary: 'Acurácia histórica do algoritmo', responses: { 200: { description: 'Métricas de acurácia' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/publish-status': {
      get: { tags: ['Research (Admin)'], summary: 'Estado da última publicação', responses: { 200: { description: 'Status' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/research/generate-explainable': {
      post: { tags: ['Research (Admin)'], summary: 'Gera explicações (XAI) do ranking', responses: { 200: { description: 'Explicações geradas' }, 403: { description: 'Requer ADMIN' } } },
    },

    // ===================== MARKET =====================
    '/market/landing': {
      get: { tags: ['Market'], summary: 'Dados públicos da landing page', security: [], responses: { 200: { description: 'Dados de destaque' } } },
    },
    '/market/logo/{ticker}': {
      get: { tags: ['Market'], summary: 'Logo de um ativo', security: [], parameters: [{ name: 'ticker', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Imagem/URL do logo' } } },
    },
    '/market/price': {
      get: { tags: ['Market'], summary: 'Preço histórico de um ticker', parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Preço histórico' } } },
    },
    '/market/quote': {
      get: { tags: ['Market'], summary: 'Cotação detalhada de um ticker', parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Cotação' } } },
    },
    '/market/status/{ticker}': {
      get: { tags: ['Market'], summary: 'Status de saúde de um ativo', parameters: [{ name: 'ticker', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Status' } } },
    },

    // ===================== SUBSCRIPTION =====================
    '/subscription/return': {
      get: { tags: ['Subscription'], summary: 'Callback de retorno do checkout', security: [], responses: { 302: { description: 'Redireciona para o app' } } },
    },
    '/subscription/checkout': {
      post: { tags: ['Subscription'], summary: 'Inicia checkout de um plano', responses: { 200: { description: 'Preferência de pagamento' } } },
    },
    '/subscription/test-checkout': {
      post: { tags: ['Subscription'], summary: 'Checkout de teste (admin)', responses: { 200: { description: 'Preferência de teste' }, 403: { description: 'Requer ADMIN' } } },
    },
    '/subscription/confirm': {
      post: { tags: ['Subscription'], summary: 'Confirma pagamento (legado/mock)', responses: { 200: { description: 'Confirmado' } } },
    },
    '/subscription/sync-payment': {
      post: { tags: ['Subscription'], summary: 'Força a sincronização do pagamento', responses: { 200: { description: 'Sincronizado' } } },
    },
    '/subscription/status': {
      get: { tags: ['Subscription'], summary: 'Status do plano/assinatura do usuário', responses: { 200: { description: 'Plano atual' } } },
    },
    '/subscription/check-access': {
      get: { tags: ['Subscription'], summary: 'Verifica acesso a uma feature', parameters: [{ name: 'feature', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: '{ allowed: boolean }' } } },
    },
    '/subscription/register-usage': {
      post: { tags: ['Subscription'], summary: 'Registra uso de uma feature (UsageLog)', responses: { 200: { description: 'Uso registrado' } } },
    },

    // ===================== GOALS =====================
    '/goals': {
      get: { tags: ['Goals'], summary: 'Lista as metas do usuário', responses: { 200: { description: 'Metas' } } },
      post: { tags: ['Goals'], summary: 'Cria uma meta', responses: { 201: { description: 'Meta criada' }, 400: { description: 'Validação falhou' }, 429: { description: 'Rate limit' } } },
    },
    '/goals/{id}': {
      get: { tags: ['Goals'], summary: 'Detalha uma meta', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Meta' }, 404: { description: 'Não encontrada' } } },
      put: { tags: ['Goals'], summary: 'Atualiza uma meta', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Atualizada' }, 404: { description: 'Não encontrada' } } },
      delete: { tags: ['Goals'], summary: 'Remove uma meta', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removida' }, 404: { description: 'Não encontrada' } } },
    },
    '/goals/{id}/contributions': {
      post: { tags: ['Goals'], summary: 'Adiciona um aporte à meta', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Aporte adicionado' }, 400: { description: 'Validação falhou' } } },
    },
    '/goals/{id}/contributions/{cid}': {
      delete: { tags: ['Goals'], summary: 'Remove um aporte da meta', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'cid', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Aporte removido' }, 404: { description: 'Não encontrado' } } },
    },

    // ===================== ACADEMY =====================
    '/academy/courses': {
      get: { tags: ['Academy'], summary: 'Lista os cursos', security: [], responses: { 200: { description: 'Cursos' } } },
    },
    '/academy/courses/{id}': {
      get: { tags: ['Academy'], summary: 'Detalha um curso', security: [], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Curso' }, 404: { description: 'Não encontrado' } } },
    },
    '/academy/lessons/{id}': {
      get: { tags: ['Academy'], summary: 'Detalha uma lição', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Lição' }, 404: { description: 'Não encontrada' } } },
    },
    '/academy/progress/{courseId}': {
      get: { tags: ['Academy'], summary: 'Progresso do usuário num curso', parameters: [{ name: 'courseId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Progresso' } } },
    },
    '/academy/progress': {
      post: { tags: ['Academy'], summary: 'Atualiza o progresso de uma lição', responses: { 200: { description: 'Progresso salvo' } } },
    },
    '/academy/certificate/{courseId}': {
      get: { tags: ['Academy'], summary: 'Gera o certificado de conclusão', parameters: [{ name: 'courseId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Certificado (PDF)' }, 403: { description: 'Curso não concluído' } } },
    },
    '/academy/quiz/{courseId}': {
      get: { tags: ['Academy'], summary: 'Quiz de um curso', parameters: [{ name: 'courseId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Quiz' } } },
    },
    '/academy/quiz/submit': {
      post: { tags: ['Academy'], summary: 'Submete respostas do quiz', responses: { 200: { description: 'Resultado do quiz' } } },
    },
    '/academy/seed': {
      post: { tags: ['Academy'], summary: 'Popula cursos de exemplo (admin)', responses: { 200: { description: 'Seed executado' }, 403: { description: 'Requer ADMIN' } } },
    },

    // ===================== NOTIFICATIONS =====================
    '/notifications': {
      get: { tags: ['Notifications'], summary: 'Lista as notificações do usuário', responses: { 200: { description: 'Notificações' } } },
    },
    '/notifications/{id}/read': {
      put: { tags: ['Notifications'], summary: 'Marca uma notificação como lida', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Marcada como lida' }, 404: { description: 'Não encontrada' } } },
    },
    '/notifications/read-all': {
      post: { tags: ['Notifications'], summary: 'Marca todas como lidas', responses: { 200: { description: 'Todas marcadas' } } },
    },

    // ===================== WEBHOOKS =====================
    '/webhooks/mercadopago': {
      post: { tags: ['Webhooks'], summary: 'Recebe eventos do Mercado Pago', security: [], responses: { 200: { description: 'Evento processado' } } },
    },
  },
};

// `apis` permite anotar rotas com comentários @openapi no futuro — são mescladas.
export const swaggerSpec = swaggerJSDoc({
  definition,
  apis: ['./routes/*.js'],
});
