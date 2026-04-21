# 🧠 Diretrizes Master: Vértice - Motor Quant v3

Você é um Engenheiro de Software Full-Stack Sênior e Arquiteto de Sistemas atuando na **Vértice**, uma plataforma institucional de análise quantitativa financeira. Seu objetivo é manter, escalar e debugar um sistema complexo de recomendação de investimentos (Ações, FIIs, Cripto).

---

## 🏗️ 1. Arquitetura e Stack Tecnológico

O projeto é um **Monorepo** com script `dev` que roda client e server em paralelo via `concurrently`.

- **Frontend (`/client`):** React 18, TypeScript, Vite, Tailwind CSS (Design System restrito), Recharts (gráficos), Lucide React (ícones), React Query v5 (`@tanstack/react-query`), React Router v6 (HashRouter), Framer Motion, React Player.
- **Backend (`/server`):** Node.js com ES Modules (`"type": "module"`), Express 4, MongoDB (Mongoose 8), Google Gemini (`@google/genai`), Yahoo Finance (`yahoo-finance2`), Mercado Pago SDK, Winston (logs), node-cron (agendamento), Sentry (monitoramento), Zod (validação).
- **Dev tooling:** Nodemon (server), Vite HMR (client), Vitest (testes).

---

## 📁 2. Mapa de Arquivos (Monorepo)

```
/                              ← Raiz do monorepo
├── CLAUDE.md                  ← Este arquivo (diretrizes da AI)
├── package.json               ← Orquestrador: scripts dev/build/start
├── nodemon.json               ← Config auto-reload do server
├── .env                       ← Secrets (MongoDB, JWT, Gemini, MercadoPago, Sentry)
│
├── /client                    ← React 18 + TypeScript + Vite
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── /src
│       ├── App.tsx            ← HashRouter + ProtectedRoute + AuthProvider
│       ├── main.tsx
│       ├── /pages             ← Páginas principais
│       │   ├── Dashboard.tsx
│       │   ├── Wallet.tsx
│       │   ├── Research.tsx
│       │   ├── Radar.tsx
│       │   ├── Indicators.tsx
│       │   ├── Profile.tsx
│       │   ├── Pricing.tsx
│       │   ├── Courses.tsx
│       │   ├── CoursePlayer.tsx
│       │   ├── Landing.tsx
│       │   ├── Login.tsx
│       │   ├── Register.tsx
│       │   ├── ForgotPassword.tsx
│       │   ├── ResetPassword.tsx
│       │   ├── Checkout.tsx
│       │   └── AdminPanel.tsx
│       ├── /components        ← Componentes reutilizáveis
│       │   ├── Header.tsx
│       │   ├── MarketStatusBar.tsx
│       │   ├── EquitySummary.tsx
│       │   ├── AssetTable.tsx
│       │   ├── AiRadar.tsx
│       │   ├── ResearchViewer.tsx
│       │   ├── AssetDetailModal.tsx   ← Modal deep-dive de ativo (pesquisa)
│       │   ├── AuditDetailModal.tsx   ← Modal de log de auditoria
│       │   ├── AddAssetModal.tsx
│       │   ├── SmartContributionModal.tsx
│       │   ├── AssetTransactionsModal.tsx
│       │   ├── InstantReportModal.tsx
│       │   ├── ConfirmModal.tsx
│       │   ├── TutorialOverlay.tsx
│       │   ├── PageLoader.tsx
│       │   ├── EvolutionChart.tsx
│       │   ├── AllocationChart.tsx
│       │   ├── PerformanceChart.tsx
│       │   └── DividendDashboard.tsx
│       ├── /contexts
│       │   ├── AuthContext.tsx        ← user, isAuthenticated, login, logout
│       │   ├── WalletContext.tsx      ← assets, kpis, history, addAsset, removeAsset
│       │   ├── DemoContext.tsx        ← Tutorial mode interativo
│       │   └── ToastContext.tsx       ← Notificações globais
│       ├── /hooks
│       │   └── useDashboardData.ts   ← Agrega dados do dashboard via React Query
│       ├── /services              ← Camada de chamadas HTTP ao backend
│       │   ├── auth.ts
│       │   ├── wallet.ts
│       │   ├── research.ts
│       │   ├── market.ts
│       │   ├── subscription.ts
│       │   └── academy.ts
│       └── /types                 ← Interfaces TypeScript centrais
│
└── /server                    ← Node.js + Express (ES Modules)
    ├── index.js               ← Boot: .env → Sentry → DB → Server → ErrorHandlers
    ├── app.js                 ← Express: Helmet, CORS, Rate Limit, Rotas, Static
    ├── /config
    │   ├── db.js              ← MongoDB connection (Mongoose, pool=10)
    │   ├── logger.js          ← Winston (console + error.log + combined.log)
    │   ├── subscription.js    ← Planos ESSENTIAL/PRO/BLACK + limites de features
    │   ├── financialConstants.js ← Constantes de cálculo financeiro
    │   ├── sectorTaxonomy.js  ← Mapeamento de setores
    │   └── sectorOverrides.js ← Overrides por setor
    ├── /routes
    │   ├── authRoutes.js
    │   ├── marketRoutes.js
    │   ├── researchRoutes.js
    │   ├── walletRoutes.js
    │   ├── subscriptionRoutes.js
    │   ├── webhookRoutes.js
    │   └── academyRoutes.js
    ├── /controllers
    │   ├── authController.js
    │   ├── marketController.js
    │   ├── researchController.js
    │   ├── walletController.js
    │   ├── subscriptionController.js
    │   ├── webhookController.js
    │   └── academyController.js
    ├── /models                ← 23 schemas MongoDB/Mongoose
    │   ├── User.js
    │   ├── RefreshToken.js
    │   ├── MarketAsset.js
    │   ├── UserAsset.js
    │   ├── AssetTransaction.js
    │   ├── AssetHistory.js
    │   ├── MarketAnalysis.js  ← Rankings e boletins salvos
    │   ├── QuantSignal.js     ← Sinais técnicos (TTL 90 dias)
    │   ├── WalletSnapshot.js
    │   ├── AlgorithmPerformance.js
    │   ├── DividendEvent.js
    │   ├── TreasuryBond.js
    │   ├── EconomicIndex.js
    │   ├── SystemConfig.js    ← Cache de macro (SELIC, CDI, IPCA, etc.)
    │   ├── Transaction.js
    │   ├── Course.js
    │   ├── Lesson.js
    │   ├── UserProgress.js
    │   ├── Quiz.js
    │   ├── QuizAttempt.js
    │   ├── AuditLog.js
    │   ├── DiscardLog.js
    │   └── UsageLog.js
    ├── /services
    │   ├── /engines           ← CORE: lógica de análise isolada aqui
    │   │   ├── scoringEngine.js    ← Scores de Qualidade/Valuation/Risco + perfis
    │   │   ├── portfolioEngine.js  ← Draft competitivo + penalidades de concentração
    │   │   └── signalEngine.js     ← RSI, Volume Spike, Support Zone + filtros macro
    │   ├── aiResearchService.js    ← Orquestrador: dados → engines → Gemini → MongoDB
    │   ├── marketDataService.js    ← Cotações + cache + fallback por histórico
    │   ├── externalMarketService.js ← Yahoo Finance → Google Finance → Brapi
    │   ├── fundamentusService.js   ← Scraping de dados BR
    │   ├── macroDataService.js     ← SELIC, IPCA, CDI, Ibov, Dólar, BTC
    │   ├── aiEnhancementService.js ← Enriquecimento Gemini de narrativas
    │   ├── paymentService.js       ← Mercado Pago checkout/webhook
    │   ├── emailService.js         ← Nodemailer (reset senha, recibos)
    │   ├── schedulerService.js     ← Cron jobs (node-cron)
    │   ├── syncService.js
    │   ├── holidayService.js
    │   └── /workers
    │       └── timeSeriesWorker.js
    ├── /middleware
    │   ├── authMiddleware.js   ← JWT verify + role check
    │   └── validateResource.js ← Zod validation
    ├── /schemas
    │   └── authSchemas.js
    ├── /scripts               ← Utilitários de seed/sync/backtest
    └── /tests                 ← Vitest
```

---

## ⚙️ 3. Core Engines (O Cérebro do Backend)

Toda lógica de pontuação e alocação fica em `/server/services/engines/`. Se precisar alterar regras matemáticas, mexa aqui.

### `scoringEngine.js`
Avalia cada ativo em **3 dimensões estruturais** e **3 perfis de risco**:

**Scores Estruturais (0–100 cada):**
- `QUALITY`: ROE, margens, dívida, crescimento, payout ratio
- `VALUATION`: P/L, P/VP, EV/EBITDA, spread vs taxa livre de risco
- `RISK`: Market cap, liquidez, alavancagem, dívida/EBITDA

**Scores por Perfil de Risco (determinam o `score` final e o `action`):**
- `DEFENSIVE`: Base 30–65pts. Bônus: large cap, dividendos >6%, ROE >15%. Penalty: -10 se P/VP>3, -5 se beta>1.2
- `MODERATE`: Base 40–60pts. Bônus: crescimento receita >10%, upside >20%. Penalty: -15 se margem <5%
- `BOLD`: Base 50pts. Bônus: +30 se PEG<1.0, +20 se upside >50%, +10 hyper-growth>25%. Penalty: -20 se volatility>60%

**Métodos de Valuation suportados:**
- **Graham**: Para ações com P/L e book value
- **Bazin**: Para ações pagadoras de dividendo (teto do preço)
- **PEG Ratio**: Valuation ajustado a crescimento
- **VP-adjusted**: Para FIIs com prêmio de yield vs NTN-B

**Lógica específica por tipo:**
- `STOCK`: análise completa de dividendo, alavancagem e crescimento
- `FII`: vacância, cap rate, qtd imóveis, spread vs NTN-B
- `CRYPTO`: tiers de market cap, volatilidade, liquidez

Também gera `auditLog[]` (fator + pontos + tipo + categoria) e `bullThesis[]`/`bearThesis[]`.

### `portfolioEngine.js`
**Draft Competitivo** em 3 tiers:
1. **GOLD**: score ≥ 55 (até 10 ativos)
2. **SILVER**: score ≥ 40 (até 10 adicionais)
3. **BRONZE**: score > 30 (backfill)

**Penalidades de Concentração:**
- 3+ ativos no mesmo macro-setor: -5 a -15 pontos
- 3+ FIIs do mesmo gestor: -20 pontos
- Após penalidade: `action` é recalculado (pode virar WAIT se score cair abaixo de 70)

Limite por setor: máx 4 ativos para DEFENSIVE, máx 2 para outros perfis.

### `signalEngine.js`
Detecta sinais técnicos:
- **RSI**: período 14. Oversold < 30, Overbought > 70
- **VOLUME_SPIKE**: volume anormal vs média histórica
- **SUPPORT_ZONE**: preço próximo a suporte técnico

**Filtros macro** (via `getMacroContext()`):
- Circuit breaker: bloqueia sinais de compra se mercado cair > 2.5%
- Bloqueia ações de petróleo se petróleo cair > 1.5%
- Bloqueia VALE3 em fraqueza macro

**Qualidade dos sinais:** `GOLD` ou `SILVER`
**Liquidez mínima:** R$ 500k/dia para ser escaneado

### `aiResearchService.js` (Orquestrador)
Fluxo de `calculateRanking(assetClass, strategy)`:
1. Buscar dados de mercado por classe de ativo
2. Carregar contexto macro do `SystemConfig`
3. Passar cada ativo pelo `scoringEngine`
4. Logar ativos descartados em `DiscardLog` (baixa liquidez, blacklisted, etc.)
5. Rodar draft + penalidades do `portfolioEngine`
6. Ordenar por score (soberano)
7. Calcular deltas de posição vs relatório anterior
8. Salvar `MarketAnalysis` no MongoDB

---

## 🛡️ 4. Regras de Negócio de Ferro (INVIOLÁVEIS)

- **Regra 1 — Threshold Global = 70:**
  - `score >= 70` → `action: 'BUY'`
  - `score < 70` → `action: 'WAIT'` ou `'SELL'`
  - Vale em TODO o sistema (Gold, Silver, Bronze, qualquer aba).

- **Regra 2 — Ordenação Soberana (Score-Based):**
  - Exibição e listagem final sempre por `b.score - a.score`. Score 85 nunca fica abaixo de 55.

- **Regra 3 — Perfis de Risco:**
  - Cada ativo tem: `DEFENSIVE`, `MODERATE` ou `BOLD`.
  - Frontend filtra o `auditLog[]` para mostrar só critérios do perfil do ativo (não mostrar "Regras Defensivas" para "Arrojados").

- **Regra 4 — Delta de Posição:**
  - Ranking compara posição global atual com o relatório anterior para gerar a "Seta Direcional" (Subiu/Caiu/Manteve).

---

## 🗄️ 5. Modelos MongoDB (23 Collections)

### Autenticação
**`User`**: `name`, `email` (unique), `cpf`, `password` (hash), `role` (USER|ADMIN), `plan` (GUEST|ESSENTIAL|PRO|BLACK), `subscriptionStatus` (ACTIVE|PAST_DUE|CANCELED|TRIAL), `validUntil`, `hasSeenTutorial`, `mpCustomerId`, `mpSubscriptionId`, `resetPasswordToken`, `resetPasswordExpires`

**`RefreshToken`**: `user` (ref), `token`, `expiresAt`

### Portfólio
**`MarketAsset`** (cache de dados de mercado):
- Identificação: `ticker` (unique), `name`, `type` (STOCK|FII|STOCK_US|CRYPTO|FIXED_INCOME|CASH), `currency` (BRL|USD), `sector`
- Flags: `isIgnored`, `isBlacklisted`, `isTier1`, `isActive`, `failCount`
- Métricas STOCK: `pl`, `roe`, `roic`, `netMargin`, `evEbitda`, `revenueGrowth`, `debtToEquity`, `netDebt`, `payout`
- Métricas FII: `vacancy`, `p_vp`, `dy`, `capRate`, `qtdImoveis`
- Séries: `volatility`, `beta`, `sma200`, `ema50`
- Preço: `lastPrice`, `change`, `marketCap`, `liquidity`, `lastAnalysisDate`, `updatedAt`

**`UserAsset`** (holdings do usuário): `user` (ref), `ticker`, `type`, `quantity`, `totalCost`, `realizedProfit` (PPM), `fifoRealizedProfit` (FIFO), `taxLots[]` (date, qty, price), `currency`, `startDate`, `fixedIncomeRate`, `tags[]`

**`AssetTransaction`**: `user`, `ticker`, `assetId`, `type` (BUY|SELL), `quantity`, `price`, `totalValue`, `date`, `notes`

**`AssetHistory`**: `ticker`, `history[]` (OHLCV), TTL automático

### Research e Análise
**`MarketAnalysis`** (Rankings/Boletins salvos):
- `date`, `assetClass` (STOCK|FII|CRYPTO), `strategy` (BUY_HOLD)
- `isRankingPublished`, `isMorningCallPublished`
- `content.morningCall` (texto), `content.ranking[]` (ver RankingItem abaixo), `content.fullAuditLog[]`
- `generatedBy` (ref admin User)

**RankingItem** (subdocumento de `MarketAnalysis`):
`position`, `previousPosition`, `ticker`, `name`, `sector`, `type`, `action` (BUY|WAIT|SELL), `currentPrice`, `targetPrice`, `score`, `probability`, `riskProfile`, `thesis`, `auditLog[]`, `bullThesis[]`, `bearThesis[]`, `metrics` (todos os indicadores)

**`QuantSignal`**: `ticker`, `assetType`, `riskProfile`, `type` (RSI_OVERSOLD|VOLUME_SPIKE|DEEP_VALUE|SUPPORT_ZONE), `quality` (GOLD|SILVER), `value`, `message`, `priceAtSignal`, `status` (ACTIVE|HIT|MISS|NEUTRAL), `finalPrice`, `resultPercent`, `auditDate`, TTL 90 dias

**`DiscardLog`**: `runId`, `ticker`, `reason`, `details`, `assetType`, `timestamp`

### Performance
**`WalletSnapshot`**: `user`, `date`, `totalEquity`, `totalInvested`, `totalDividends`, `profit`, `profitPercent`, `quotaPrice` (TWRR), `allocation` (por tipo de ativo)

**`AlgorithmPerformance`**: `signalId`, `outcome` (HIT|MISS), `returnPercent`, `holdDays`, `auditDate`

### Dados Financeiros
**`DividendEvent`**: `ticker`, `date`, `amount`, `type` (DIVIDEND|JUROS|AMORTIZACAO)

**`TreasuryBond`**: `title`, `maturityDate`, `rate`, `type` (NTNB|NTN-F|LTN), `price`, `ytm`, `duration`

**`EconomicIndex`**: `key` (SELIC|CDI|IPCA|etc), `value`, `date`, `source`

**`SystemConfig`** (Cache global de macro):
- Taxas: `selic`, `ipca`, `cdi`, `cdiReturn12m`, `riskFree`, `ntnbLong`
- Câmbio: `dollar`, `dollarChange`
- Índices: `ibov`, `ibovChange`, `ibovReturn12m`, `spx`, `spxChange`, `spxReturn12m`
- Cripto: `btc`, `btcChange`
- Config: `backtestHorizon` (dias para validação de sinais)
- Observabilidade: `lastSyncStats`, `lastSnapshotStats`, `lastTimeSeriesStats`, `lastUpdated`

**`Transaction`** (Pagamentos): `user`, `plan`, `amount`, `currency`, `status` (PENDING|PAID|FAILED|REFUNDED), `gatewayId`, `method` (CREDIT_CARD|PIX|CRYPTO)

### Educação
**`Course`**, **`Lesson`**, **`UserProgress`**, **`Quiz`**, **`QuizAttempt`**

### Auditoria
**`AuditLog`**: `user`, `email`, `action` (LOGIN|LOGOUT|etc), `details`, `ipAddress`, `userAgent`, `timestamp`

**`UsageLog`**: `user`, `feature`, `count`, `date`

---

## 🌐 6. API Routes (todos os endpoints)

Base URL: `/api`

### Auth
```
POST   /register                    Cadastro de usuário
POST   /login                       Login (retorna accessToken + seta refresh cookie)
POST   /refresh                     Renova accessToken via cookie
POST   /logout                      Invalida sessão
POST   /forgot-password             Solicita reset de senha
POST   /reset-password              Confirma reset com token
PUT    /me                          Atualiza perfil (autenticado)
POST   /change-password             Troca senha (autenticado)
POST   /tutorial-seen               Marca tutorial como visto
```

### Market (`/api/market`)
```
GET    /landing                     Dados públicos da landing page
GET    /price?ticker&date&type      Histórico de preço de ativo
GET    /quote?ticker                Cotação ao vivo
GET    /status/:ticker              Saúde do ativo (admin debug)
```

### Research (`/api/research`)
```
GET    /latest?assetClass&strategy  Último boletim publicado
GET    /macro                       Indicadores macro atuais (SELIC, CDI, Ibov, etc.)
GET    /signals                     Sinais quantitativos ativos
GET    /signals?history=true        Histórico de sinais com status
GET    /radar-stats                 Estatísticas do engine de sinais
GET    /discard-logs                Ativos descartados do ranking
GET    /accuracy?assetClass&days    Acurácia do algoritmo
GET    /history                     Histórico de publicações (admin)
GET    /details/:id                 Detalhes de um boletim (admin)
GET    /data-quality                Métricas de qualidade de dados (admin)
POST   /crunch                      Calcula scores de ativos (admin)
POST   /full-pipeline               Roda pipeline completo (admin)
POST   /enhance                     Enriquece narrativas via AI (admin)
POST   /narrative                   Gera Morning Call via Gemini (admin)
POST   /publish                     Publica boletim (admin)
POST   /sync-market                 Sincroniza dados de mercado (admin)
POST   /sync-macro                  Sincroniza indicadores macro (admin)
POST   /config/backtest             Atualiza config de backtesting (admin)
POST   /reset-health                Reseta contadores de saúde de ativos (admin)
DELETE /signals/history             Limpa histórico de sinais (admin)
```

### Wallet (`/api/wallet`)
```
GET    /                            Resumo da carteira (assets + KPIs)
GET    /history                     Histórico de performance
GET    /search?q=                   Busca de ativos para adicionar
GET    /transactions/:ticker        Histórico de transações de um ativo
GET    /performance                 Métricas vs benchmarks (CDI, Ibov)
GET    /dividends                   Renda de dividendos
GET    /cashflow?page&limit&filterType  Extrato de movimentação
GET    /snapshot-health             Qualidade dos snapshots (admin)
POST   /add                         Adiciona transação
POST   /reset                       Zera toda a carteira
POST   /fix-splits                  Lida com desdobramentos corporativos
POST   /fix-snapshots               Repara snapshots (admin)
POST   /admin/snapshot/force        Força snapshot manual (admin)
PUT    /:id                         Atualiza ativo
DELETE /:id                         Remove ativo
DELETE /transactions/:id            Remove transação específica
```

### Subscription (`/api/subscription`)
```
GET    /return                      Handler de retorno do Mercado Pago (público)
GET    /status                      Status da assinatura atual
GET    /check-access                Verifica acesso a feature
POST   /checkout                    Cria sessão de pagamento
POST   /confirm                     Confirma pagamento (legado)
POST   /sync-payment                Força sync de status de pagamento
POST   /register-usage              Loga uso de feature
```

### Webhooks (`/api/webhooks`)
```
POST   /mercadopago                 Recebe notificações do Mercado Pago
```

### Academy (`/api/academy`)
```
GET    /courses                     Lista cursos
GET    /courses/:id                 Detalhes do curso
GET    /lessons/:id                 Detalhes da aula
GET    /progress/:courseId          Progresso do usuário no curso
GET    /quiz/:courseId              Quiz do curso
GET    /certificate/:courseId       Gera certificado PDF
POST   /progress                    Atualiza progresso de aula
POST   /quiz/submit                 Envia respostas do quiz
POST   /seed                        Popula dados iniciais (dev)
POST   /complete-course/:courseId   Marca curso completo (dev)
```

---

## 💳 7. Planos e Acesso (Feature Gating)

Planos definidos em `/server/config/subscription.js`.

| Feature | GUEST | ESSENTIAL (R$39,90/mês) | PRO (R$119,90/mês) | BLACK (R$349,90/mês) |
|---------|-------|--------------------------|---------------------|----------------------|
| Terminal / Carteira | ✅ | ✅ | ✅ | ✅ |
| Brasil 10 (ranking) | ✅ | ✅ | ✅ | ✅ |
| Academy básico | ✅ | ✅ | ✅ | ✅ |
| Sinais com delay | ❌ | ✅ | ✅ | ✅ |
| Aporte Inteligente | ❌ | ❌ | ✅ | ✅ |
| Radar Alpha | ❌ | ❌ | ✅ | ✅ |
| Research Ações/FIIs/Cripto | ❌ | ❌ | ✅ | ✅ |
| Rebalanceamento IA | ❌ | ❌ | ❌ | ✅ |
| Ativos Globais | ❌ | ❌ | ❌ | ✅ |
| Relatórios Privados | ❌ | ❌ | ❌ | ✅ |
| Alertas IR, WhatsApp, Calls | ❌ | ❌ | ❌ | ✅ |

**Hierarquia de planos:** GUEST (0) < ESSENTIAL (1) < PRO (2) < BLACK (3)

---

## 🎨 8. Design System e Frontend (Padrão Vértice)

Não crie CSS customizado se puder resolver com Tailwind. Respeite o **Dark Mode Institucional**.

### Paleta de Cores Base
- Fundos: `#05070A` (deepest), `#080C14` (main), `#0B101A` e `#0F131E` (cards e modais)
- Tipografia: menus e subtítulos em `slate-500` (uppercase + tracking-widest). Headers em `text-white`

### Acentos e Badges (Semáforo Quant)
- COMPRAR / Defensivo / Graham: `emerald-400` a `emerald-500`
- AGUARDAR / Concentração / Alertas: `yellow-400` a `yellow-500`
- Risco Alto / Bazin / Perfis: `blue-400` a `blue-500` e `purple-400` a `purple-500`
- Vermelho só para erros críticos: `red-400` a `red-500`

### Padrões de Interface
- Use `<div className="animate-fade-in">` para entradas suaves
- Modais DEVEM usar `createPortal`, `z-[100]` e `backdrop-blur-md` escuro (`bg-black/95`)
- Barras de progresso e charts: `transition-all duration-1000 ease-out`

### Convenções React
- `useState` e `useMemo` DEVEM ser no topo do componente. Retornos de proteção (`if (!data) return null`) vêm estritamente **após** os hooks
- Valores financeiros: Cripto usa `$`, B3 usa `R$`
- Formatação: use `Intl.NumberFormat` ou padrão já usado no projeto

### Roteamento
- `HashRouter` (não BrowserRouter)
- Proteção de rotas via `<ProtectedRoute>` (autenticado) e `<AdminRoute>` (role ADMIN)
- `<PublicOnlyRoute>` redireciona para `/dashboard` se autenticado
- Code splitting com `<Suspense fallback={<PageLoader />}>`

### Páginas e Componentes Principais

**Dashboard** — `Dashboard.tsx`
- `EquitySummary` (4 KPI cards: patrimônio, aplicado, lucro, proventos)
- `AssetTable` (ativos com score IA e sentimento BULLISH/BEARISH/NEUTRAL)
- `AiRadar` (sinais ativos + tipo + impacto)
- `MarketStatusBar` (IBOV, CDI, USD, BTC, S&P)
- `InstantReportModal` (Morning Call do BRASIL_10)

**Wallet** — `Wallet.tsx`
- 4 abas: OVERVIEW (evolução + alocação), PERFORMANCE (vs CDI/Ibov), DIVIDENDS, STATEMENT
- Modais: `AddAssetModal`, `SmartContributionModal`, `AssetTransactionsModal`

**Research** — `Research.tsx`
- Asset selector: BRASIL_10, STOCK, FII, CRYPTO, STOCK_US
- 3 view modes: RANKING (Top 10), ANALYSIS (boletim texto), EXPLAINABLE_AI (discard logs)
- `AssetDetailModal` para deep-dive em ativo
- `AuditDetailModal` para log de scoring

**Radar** — `Radar.tsx`
- Win rate pie chart, sector heatmap, tabela de histórico de sinais
- Filtros: ALL | ACTIVE | HIT | MISS

**Indicators** — `Indicators.tsx`
- Grid de 7 indicadores macro (SELIC, CDI, IPCA, Ibovespa, Dólar, S&P500, Bitcoin)
- Tabela colapsável de Tesouro Direto (filtros: IPCA, PREFIXADO, SELIC)
- Tabela colapsável de CDBs e poupança

---

## 🔌 9. Contextos e Hooks (Frontend)

### AuthContext
```typescript
interface User {
  id: string; name: string; email: string;
  plan: 'GUEST' | 'ESSENTIAL' | 'PRO' | 'BLACK';
  subscriptionStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIAL';
  role: 'USER' | 'ADMIN';
  validUntil?: string;
  hasSeenTutorial?: boolean;
}
// Providers: user, isAuthenticated, isLoading, login(), logout(), refreshProfile()
```

### WalletContext
```typescript
type AssetType = 'STOCK' | 'FII' | 'CRYPTO' | 'STOCK_US' | 'FIXED_INCOME' | 'CASH';
interface Asset {
  id, ticker, type, quantity, averagePrice, currentPrice,
  totalValue, totalCost, profit, profitPercent,
  currency: 'BRL' | 'USD', name?, sector?, dayChangePct?
}
interface WalletKPIs {
  totalEquity, totalInvested, totalResult, totalResultPercent,
  dayVariation, dayVariationPercent, totalDividends, projectedDividends,
  weightedRentability, dataQuality?: 'AUDITED' | 'ESTIMATED', sharpeRatio?, beta?
}
// Providers: assets, kpis, history, isPrivacyMode, addAsset(), removeAsset(), resetWallet()
// Demo mode: retorna DEMO_ASSETS/DEMO_KPIS quando isDemoMode=true
```

### DemoContext
- Auto-inicia se `user.hasSeenTutorial === false` (delay 1.2s)
- IDs de tutorial: `tour-equity`, `tour-allocation`, `tour-radar`, `tour-dividends`, `tour-wallet-*`
- Ao completar: chama `POST /api/tutorial-seen`

### ToastContext
- `addToast(message, type: 'success' | 'error' | 'info')` — auto-dismiss em 4s

### useDashboardData (React Query)
- `macroQuery`: `/api/research/macro` — cache 15min
- `dividendsQuery`: `/api/wallet/dividends` — cache 5min
- `signalsQuery`: `/api/research/signals` — cache 5min
- `researchQuery`: `/api/research/latest` — cache 1h
- Retorna: `portfolio`, `signals`, `equity`, `dividends`, `marketIndices`, `systemHealth`, `isLoading`

### Token Refresh
- Interceptor automático em 401: fila de requests aguarda novo token
- Redirect para `/login` em 401 persistente após refresh falhar

---

## 🔗 10. Integrações Externas

### Fontes de Dados de Mercado (prioridade)
1. **Yahoo Finance** (`yahoo-finance2`) — principal para ações, ETFs, índices, cripto
2. **Google Finance** (scraping via `cheerio`) — fallback para dados faltantes
3. **Brapi** — fallback para ações brasileiras (token em `.env: BRAPI_TOKEN`)
4. **Fundamentus** (scraping) — dados fundamentalistas BR

### Google Gemini AI
- Package: `@google/genai`
- Usado em: `aiEnhancementService.js`, `aiResearchService.js`
- Funções: Morning Call, narrativas de tese, contexto de mercado
- Key: `.env: API_KEY`

### Mercado Pago
- Package: `mercadopago`
- Usado em: `paymentService.js`, `webhookController.js`
- Tokens: `.env: MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`

### Sentry
- Package: `@sentry/node` (server), `@sentry/react` (client)
- Monitoramento de erros e performance
- DSN: `.env: SENTRY_DSN`, `VITE_SENTRY_DSN`

### Email
- Package: `nodemailer`
- SMTP: `.env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM`

---

## 🛠️ 11. Como você (AI) deve agir neste repositório

1. **Sem alucinações de bibliotecas:** Ícones = `lucide-react`, gráficos = `recharts`, data fetching = `@tanstack/react-query`, animações = `framer-motion`. Não invente outras.

2. **Contexto antes da ação — mapa de onde mexer:**
   - Mudar cálculo do Bazin/Graham → `scoringEngine.js`
   - Mudar regras do draft ou penalidades → `portfolioEngine.js`
   - Mudar detecção de sinais técnicos → `signalEngine.js`
   - Mudar lógica de geração do boletim → `aiResearchService.js`
   - Mudar busca de cotações → `marketDataService.js` ou `externalMarketService.js`
   - Mudar visual da aba Pesquisa → `Research.tsx`, `AssetDetailModal.tsx`, `AuditDetailModal.tsx`
   - Mudar visual da carteira → `Wallet.tsx`, `EvolutionChart.tsx`, `AllocationChart.tsx`
   - Mudar dados do dashboard → `Dashboard.tsx`, `useDashboardData.ts`, `EquitySummary.tsx`
   - Mudar dados de macro → `macroDataService.js`, `SystemConfig` model
   - Mudar planos e acessos → `/server/config/subscription.js`

3. **Acompanhe o fluxo completo:** Se alterar penalidade no backend que afete score, garanta que `action` seja recalculado (`score >= 70 → BUY`) antes de salvar no banco.

4. **Respostas diretas:** Entregue código refatorado pronto. Foque nas regras de negócio da Vértice, não em conceitos básicos de programação.

5. **ES Modules no server:** O backend usa `import/export` (não `require`). Não introduza `require()`.

6. **Variáveis de ambiente:** Nunca hardcode secrets. Consulte `.env` para nomes das variáveis.
