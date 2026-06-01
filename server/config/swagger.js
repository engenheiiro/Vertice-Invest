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
    { name: 'Wallet', description: 'Carteira, transações e performance' },
    { name: 'Research', description: 'Ranking, macro e sinais' },
    { name: 'Market', description: 'Cotações' },
    { name: 'Subscription', description: 'Planos e pagamentos' },
  ],
  paths: {
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
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Credenciais' } } } },
        responses: { 200: { description: 'Autenticado (accessToken + refresh cookie)' }, 401: { description: 'Credenciais inválidas' } },
      },
    },
    '/refresh': {
      post: { tags: ['Auth'], summary: 'Renova o access token via refresh cookie', security: [], responses: { 200: { description: 'Novo access token' }, 401: { description: 'Refresh inválido' } } },
    },
    '/logout': {
      post: { tags: ['Auth'], summary: 'Encerra a sessão e invalida o refresh token', responses: { 200: { description: 'Sessão encerrada' } } },
    },
    '/me': {
      put: { tags: ['Auth'], summary: 'Atualiza perfil (nome, CPF)', responses: { 200: { description: 'Perfil atualizado' }, 409: { description: 'CPF já utilizado' } } },
    },
    '/wallet': {
      get: { tags: ['Wallet'], summary: 'Carteira consolidada + KPIs', responses: { 200: { description: 'Ativos e KPIs' }, 401: { description: 'Não autenticado' } } },
    },
    '/wallet/add': {
      post: {
        tags: ['Wallet'], summary: 'Registra uma transação (compra/venda)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransacaoCarteira' } } } },
        responses: { 201: { description: 'Transação registrada' }, 400: { description: 'Validação falhou' }, 429: { description: 'Rate limit por usuário' } },
      },
    },
    '/wallet/{id}': {
      put: { tags: ['Wallet'], summary: 'Atualiza tags do ativo', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Atualizado' }, 404: { description: 'Ativo não encontrado' } } },
      delete: { tags: ['Wallet'], summary: 'Remove ativo e suas transações', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removido' }, 404: { description: 'Não encontrado' } } },
    },
    '/wallet/performance': {
      get: { tags: ['Wallet'], summary: 'Série histórica TWRR vs benchmarks (CDI/IPCA/IBOV)', responses: { 200: { description: 'Histórico + stats (sharpe/beta)' } } },
    },
    '/research/latest': {
      get: { tags: ['Research'], summary: 'Último ranking publicado', parameters: [{ name: 'assetClass', in: 'query', schema: { type: 'string', enum: ['STOCK', 'FII', 'CRYPTO'] } }], responses: { 200: { description: 'Ranking' } } },
    },
    '/research/macro': {
      get: { tags: ['Research'], summary: 'Indicadores macro (SELIC, IPCA, CDI, IBOV)', responses: { 200: { description: 'Macro atual' } } },
    },
    '/research/signals': {
      get: { tags: ['Research'], summary: 'Sinais técnicos (RSI/Volume/Suporte)', responses: { 200: { description: 'Sinais' } } },
    },
    '/market/quote': {
      get: { tags: ['Market'], summary: 'Cotação detalhada de um ticker', parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Cotação' } } },
    },
    '/subscription/status': {
      get: { tags: ['Subscription'], summary: 'Status do plano/assinatura do usuário', responses: { 200: { description: 'Plano atual' } } },
    },
    '/subscription/checkout': {
      post: { tags: ['Subscription'], summary: 'Inicia checkout de um plano', responses: { 200: { description: 'Preferência de pagamento' } } },
    },
  },
};

// `apis` permite anotar rotas com comentários @openapi no futuro — são mescladas.
export const swaggerSpec = swaggerJSDoc({
  definition,
  apis: ['./routes/*.js'],
});
